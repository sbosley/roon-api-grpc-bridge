/*
 * Copyright 2019 Sam Bosley
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict'
const version = '0.1.0'
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader')
const program = require('commander')
const log = require('loglevel')

const RoonApi = require('node-roon-api')
const RoonApiStatus = require('node-roon-api-status')
const RoonApiTransport = require('node-roon-api-transport')
const RoonApiBrowse = require('node-roon-api-browse')
const RoonApiImage = require('node-roon-api-image')

const noCorePaired = {message: 'No Roon core paired', code: grpc.status.UNAVAILABLE}

function loadRoonProto() {
  var protoPath = `${__dirname}/protos/roon.proto`
  var packageDefinition = protoLoader.loadSync(
    protoPath,
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    }
  )
  return grpc.loadPackageDefinition(packageDefinition).com.sambosley.grpc.roon
}

function removeProtoDefaults(req) {
  for (var key in req) {
    if (req.hasOwnProperty(key)) {
      var value = req[key]
      if (!value) {
        delete(req[key])
      } else if (typeof value === 'object') {
        removeProtoDefaults(value)
      }
    }
  }
}

function removeEnumDefault(req, key) {
  if (req[key] && req[key].endsWith('_unspecified')) {
    delete(req[key])
  }
}

function copyFields(src, ...keys) {
  var result = {}
  keys.forEach(key => {
    if (src.hasOwnProperty(key)) {
      result[key] = src[key]
    }
  })
  return result
}

function wrapCallback(method, cb, req) {
  return function(err, resp) {
    log.debug(`${method} request:\n${JSON.stringify(req, null, 2)}`)
    if (err) {
      log.debug(`${method} error:\n${JSON.stringify(err, null, 2)}`)
    }
    if (resp) {
      log.debug(`${method} response:\n${JSON.stringify(resp, null, 2)}`)
    }
    cb(err, resp)
  }
}

// RoonService implements gRPC handlers for all RPCs defined in roon.proto
class RoonService {
  constructor() {
    this.zones = {}
    this.zoneSubscribers = []
    this.retries = []
  }

  corePaired(_core) {
    log.info('Paired with core', _core.display_name, _core.display_version)
    this.core = _core
    this.transportApi = _core.services.RoonApiTransport
    this.browseApi = _core.services.RoonApiBrowse
    this.imageApi = _core.services.RoonApiImage

    this.transportApi.subscribe_zones((response, msg) => {
      if (response === 'Subscribed') {
        this.zones = msg.zones.reduce((acc, z) => (acc[z.zone_id] = z) && acc, {})
        this.sendZonesToSubscribers({subscribed: msg})
        this.retries.forEach(r => r())
        this.retries = []
      } else if (response === 'Changed') {
        if (msg.zones_removed) msg.zones_removed.forEach(z => delete(this.zones[z.zone_id]))
        if (msg.zones_added) msg.zones_added.forEach(z => this.zones[z.zone_id] = z)
        if (msg.zones_changed) msg.zones_changed.forEach(z => this.zones[z.zone_id] = z)
        this.sendZonesToSubscribers({changed: msg})
      } else if (response === 'Unsubscribed') {
        this.zones = {}
        this.sendZonesToSubscribers({unsubscribed: {}})
      }
    })
    this.statusSvc.set_status('OK', false)
  }

  coreUnpaired(_core) {
    log.info('Core unpaired')
    this.statusSvc.set_status('No core paired', true)
    delete(this.core)
    delete(this.transportApi)
    delete(this.browseApi)
    delete(this.imageApi)
    this.zones = {}
    this.sendZonesToSubscribers({unsubscribed: {}})
  }

  // Bridge is used to implement gRPC handlers by delegating to a function of the given 
  // Roon API object.
  // Args:
  //   api: a the API object to delegate to
  //   funcName: the name of the function to delegate to as a string
  //   validateAndGetArgs: a function that takes a single argument, which will
  //     be the gRPC request body. This function should validate the request and
  //     return an array of arguments that should be passed to the Roon API function.
  //     If a validation error occurs, this function should instead return a gRPC 
  //     error object to be returned to the client.
  //   cbToResponse (optional): an optional function that takes a variadic set of
  //     arguments and converts them into a single gRPC response object. Most
  //     callers will not need this, as most of the bridged functions return only
  //     0 or 1 response objects in their callbacks, which can be mapped to the
  //     gRPC response automatically.
  bridge(method, apiName, funcName, validateAndGetArgs, cbToResponse, isRetry) {
    return (call, cb) => {
      var api = this[apiName]
      var callback = wrapCallback(method, cb, call.request)
      if (!api) {
        callback(noCorePaired)
        return
      }
      removeProtoDefaults(call.request)
      var argsOrErr = validateAndGetArgs(call.request)
      if (!(argsOrErr instanceof Array)) {
        callback(argsOrErr)
        return
      }
      api[funcName](...argsOrErr, (err, ...responseArgs) => {
        if (err) {
          if (err === 'NetworkError' && !isRetry) {
            this.retries.push(() => this.bridge(method, apiName, funcName, validateAndGetArgs, cbToResponse, true)(call, cb))
          } else {
            callback({message: `Error: ${err}`, code: grpc.status.INTERNAL})
          }
          return
        }
        var response
        if (cbToResponse) {
          response = cbToResponse(...responseArgs)
        } else if (responseArgs.length == 0) {
          response = {} // For the cases where response is emtpy, e.g. the transport APIs
        } else {
          response = responseArgs[0]
        }
        callback(null, response)
      })
    }
  }

  sendZonesToSubscribers(resp) {
    var subscribers = this.zoneSubscribers.filter(call => {
      if (call.cancelled || call.status.code) {
        call.end()
        return false
      } else return true
    })
    this.zoneSubscribers = subscribers
    subscribers.forEach(call => call.write(resp))
  }

  lookupZone(zoneId) {
    return this.zones[zoneId]
  }

  lookupOutput(outputId) {
    var zones = this.zones
    for (var zoneId in zones) {
      if (zones.hasOwnProperty(zoneId)) {
        var outputs = zones[zoneId].outputs
        if (outputs) {
          for (var output of outputs) {
            if (output.output_id === outputId) {
              return output
            }
          }
        }
      }
    }
  }

  getZone(call, cb) {
    var callback = wrapCallback('GetZone', cb, call.request)
    if (!this.core) { 
      callback(noCorePaired)
      return
    }
    var result = this.lookupZone(call.request.zone_id)
    if (result) {
      callback(null, {zone: result})
    } else {
      callback({code: grpc.status.NOT_FOUND, message: `Zone ${call.request.zone_id} not found`})
    }
  }

  zonesAsList() {
    var result = {zones: []}
    var zones = this.zones
    for (var key in zones) {
      if (zones.hasOwnProperty(key)) {
        result.zones.push(zones[key])
      }
    }
    return result
  }

  listAllZones(call, cb) {
    var callback = wrapCallback('ListAllZones', cb, call.request)
    if (!this.core) { 
      callback(noCorePaired)
      return
    }
    callback(null, this.zonesAsList())
  }

  subscribeZones(call) {
    // Ok if no core is paired; subscriber will get a call when one becomes paired
    this.zoneSubscribers.push(call)
    var resp = {subscribed: this.zonesAsList()}
    call.write(resp)
  }

  // Browse APIs

  browse(call, callback) {
    this.bridge('Browse', 'browseApi', 'browse', req => {
      if (!req.hierarchy || req.hierarchy.endsWith('_unspecified')) {
        return {message: 'Must specify a valid hierarchy', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req]
    })(call, callback)
  }

  load(call, callback) {
    this.bridge('Load', 'browseApi', 'load', req => {
      if (!req.hierarchy || req.hierarchy.endsWith('_unspecified')) {
        return {message: 'Must specify a valid hierarchy', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req]
    })(call, callback)
  }

  // Image APIs

  getImage(call, callback) {
    this.bridge('GetImage', 'imageApi', 'get_image', req => {
      if (!req.image_key) {
        return {message: 'Must specify an image_key', code: grpc.status.INVALID_ARGUMENT}
      }
      if (req.format && req.format !== 'image/jpeg' && req.format !== 'image/png') {
        return {message: 'Image format must be one of "image/jpeg" or "image/png"', code: grpc.status.INVALID_ARGUMENT}
      }
      removeEnumDefault(req, 'scale')
      if (req.scale && (!req.width || req.width <= 0 || !req.height || req.height <= 0)) {
        return {message: 'When scale is specified, must specify width and height > 0', code: grpc.status.INVALID_ARGUMENT}
      }
      var options = copyFields(req, 'scale', 'width', 'height', 'format')
      return [req.image_key, options]
    }, (contentType, imageBytes) => {
      return { content_type: contentType, image: imageBytes }
    })(call, callback)
  }

  // Transport APIs

  changeSettings(call, callback) {
    this.bridge('ChangeSettings', 'transportApi', 'change_settings', req => {
      removeEnumDefault(req, 'loop')
      var zone_or_output
      if (req.zone_id) {
        zone_or_output = this.lookupZone(req.zone_id)
        if (!zone_or_output) {
          return {message: `Zone ${req.zone_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else if (req.output_id) {
        zone_or_output = this.lookupOutput(req.output_id)
        if (!zone_or_output) {
          return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else {
        return {message: 'Must specify a zone_id or output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      if (req.shuffle) {
        req.shuffle = req.shuffle.value
      }
      if (req.auto_radio) {
        req.auto_radio = req.auto_radio.value
      }
      var settings = copyFields(req, 'shuffle', 'auto_radio', 'loop')
      return [zone_or_output, settings]
    })(call, callback)
  }

  changeVolume(call, callback) {
    this.bridge('ChangeVolume', 'transportApi', 'change_volume', req => {
      if (!req.output_id) {
        return {message: 'Must specify an output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      if (!req.how || req.how.endsWith('_unspecified')) {
        return {message: 'Must specify how', code: grpc.status.INVALID_ARGUMENT}
      }
      var output = this.lookupOutput(req.output_id)
      if (!output) {
        return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
      }
      if (!req.hasOwnProperty('value')) { req.value = 0 }
      return [output, req.how, req.value]
    })(call, callback)
  }

  control(call, callback) {
    this.bridge('Control', 'transportApi', 'control', req => {
      if (!req.control || req.control.endsWith('_unspecified')) {
        return {message: 'Must specify a control action', code: grpc.status.INVALID_ARGUMENT}
      }
      var zone_or_output
      if (req.zone_id) {
        zone_or_output = this.lookupZone(req.zone_id)
        if (!zone_or_output) {
          return {message: `Zone ${req.zone_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else if (req.output_id) {
        zone_or_output = this.lookupOutput(req.output_id)
        if (!zone_or_output) {
          return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else {
        return {message: 'Must specify a zone_id or output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      return [zone_or_output, req.control]
    })(call, callback)
  }

  convenienceSwitch(call, callback) {
    this.bridge('ConvenienceSwitch', 'transportApi', 'convenience_switch', req => {
      if (!req.output_id) {
        return {message: 'Must specify an output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      var output = this.lookupOutput(req.output_id)
      if (!output) {
        return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
      }
      var opts = copyFields(req, 'control_key')
      return [output, opts]
    })(call, callback)
  }

  groupOutputs(call, callback) {
    this.bridge('GroupOutputs', 'transportApi', 'group_outputs', req => {
      var outputsNotFound = []
      var outputs = req.output_ids.map(outputId => {
        var output = this.lookupOutput(outputId)
        if (!output) {
          outputsNotFound.push(outputId)
        }
        return output
      })
      if (outputsNotFound.length > 0) {
        return {message: `Outputs ${outputsNotFound} not found`, code: grpc.status.NOT_FOUND}
      }
      return [outputs]
    })(call, callback)
  }

  mute(call, callback) {
    this.bridge('Mute', 'transportApi', 'mute', req => {
      if (!req.output_id) {
        return {message: 'Must specify an output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      if (!req.how || req.how.endsWith('_unspecified')) {
        return {message: 'Must specify a mute action', code: grpc.status.INVALID_ARGUMENT}
      }
      var output = this.lookupOutput(req.output_id)
      if (!output) {
        return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
      }
      return [output, req.how]
    })(call, callback)
  }

  muteAll(call, callback) {
    this.bridge('MuteAll', 'transportApi', 'mute_all', req => {
      if (!req.how || req.how.endsWith('_unspecified')) {
        return {message: 'Must specify a mute action', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req.how]
    })(call, callback)
  }

  pauseAll(call, callback) {
    this.bridge('PauseAll', 'transportApi', 'pause_all', req => [])(call, callback)
  }

  seek(call, callback) {
    this.bridge('Seek', 'transportApi', 'seek', req => {
      var zone_or_output
      if (req.zone_id) {
        zone_or_output = this.lookupZone(req.zone_id)
        if (!zone_or_output) {
          return {message: `Zone ${req.zone_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else if (req.output_id) {
        zone_or_output = this.lookupOutput(req.output_id)
        if (!zone_or_output) {
          return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else {
        return {message: 'Must specify a zone_id or output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      if (!req.how || req.how.endsWith('_unspecified')) {
        return {message: 'Must specify a seek type (how)', code: grpc.status.INVALID_ARGUMENT}
      }
      if (!req.hasOwnProperty('seconds')) { req.seconds = 0 }
      return [zone_or_output, req.how, req.seconds]
    })(call, callback)
  }

  standby(call, callback) {
    this.bridge('Standby', 'transportApi', 'standby', req => {
      if (!req.output_id) {
        return {message: 'Must specify an output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      var output = this.lookupOutput(req.output_id)
      if (!output) {
        return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
      }
      var opts = copyFields(req, 'control_key')
      return [output, opts]
    })(call, callback)
  }

  toggleStandby(call, callback) {
    this.bridge('ToggleStandby', 'transportApi', 'toggle_standby', req => {
      if (!req.output_id) {
        return {message: 'Must specify an output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      var output = this.lookupOutput(req.output_id)
      if (!output) {
        return {message: `Output ${req.output_id} not found`, code: grpc.status.NOT_FOUND}
      }
      var opts = copyFields(req, 'control_key')
      return [output, opts]
    })(call, callback)
  }

  transferZone(call, callback) {
    this.bridge('TransferZone', 'transportApi', 'transfer_zone', req => {
      var from
      var to
      if (req.from_zone_id) {
        from = this.lookupZone(req.from_zone_id)
        if (!from) {
          return {message: `Zone ${req.from_zone_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else if (req.from_output_id) {
        from = this.lookupOutput(req.from_output_id)
        if (!from) {
          return {message: `Output ${req.from_output_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else {
        return {message: 'Must specify a from_zone_id or from_output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      if (req.to_zone_id) {
        to = this.lookupZone(req.to_zone_id)
        if (!to) {
          return {message: `Zone ${req.to_zone_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else if (req.to_output_id) {
        to = this.lookupOutput(req.to_output_id)
        if (!to) {
          return {message: `Output ${req.to_output_id} not found`, code: grpc.status.NOT_FOUND}
        }
      } else {
        return {message: 'Must specify a to_zone_id or to_output_id', code: grpc.status.INVALID_ARGUMENT}
      }
      return [from, to]
    })(call, callback)
  }

  ungroupOutputs(call, callback) {
    this.bridge('UngroupOutputs', 'transportApi', 'ungroup_outputs', req => {
      var outputsNotFound = []
      var outputs = req.output_ids.map(outputId => {
        var output = this.lookupOutput(outputId)
        if (!output) {
          outputsNotFound.push(outputsNotFound)
        }
        return output
      })
      if (outputsNotFound.length > 0) {
        return {message: `Outputs ${outputsNotFound} not found`, code: grpc.status.NOT_FOUND}
      }
      return [outputs]
    })(call, callback)
  }

  // gRPC and Roon APIs
  start(args) {
    this.startGRPCServer(args)
    this.startRoonDiscovery(args)
  }

  startGRPCServer(args) {
    if (this.server) {
      log.error('gRPC server already started')
      return
    }
    var roonProto = loadRoonProto()
    this.server = new grpc.Server()
    this.server.addService(roonProto.RoonService.service, this)
    log.info(`Starting gRPC server at ${args.host}`)
    this.server.bindAsync(args.host, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) {
        log.error(`Failed to bind to ${args.host}`)
        process.exit(1)
      }
      this.server.start()
    })
  }

  startRoonDiscovery(args) {
    if (this.roon) {
      log.error('RoonApi already initialized')
      return
    }
    log.info('Initializing RoonApi')
    setWorkingDir(args.root)
    this.roon = new RoonApi({
      extension_id:    'com.sambosley.grpc.roon',
      display_name:    'gRPC Bridge',
      display_version: version,
      publisher:       'Sam Bosley',
      email:           'sboz88@gmail.com',
      website:         'https://github.com/sbosley/roon-api-grpc-bridge',
      log_level:       args.roonLogLevel,
      core_paired:     core => this.corePaired(core),
      core_unpaired:   core => this.coreUnpaired(core)
    })
    
    var statusSvc = new RoonApiStatus(this.roon)
    statusSvc.set_status("Pairing...", false)
    this.statusSvc = statusSvc
  
    this.roon.init_services({
      provided_services: [statusSvc],
      required_services: [RoonApiTransport, RoonApiBrowse, RoonApiImage]
    })

    log.info('Starting Roon discovery')
    if (args.roonHost && args.roonPort) {
      this.tryDockerHostWsConnect(args.roonHost, args.roonPort)
    } else {
      this.roon.start_discovery()
    }
  }
  
  tryDockerHostWsConnect(host, port) {
    let connect = this.roon.ws_connect({host: host, port: port, onclose: () => {
      log.error('lost Roon connection, attempting to connect again...')
      setImmediate(() => this.tryDockerHostWsConnect(host, port))
    }})
    connect.transport.ws.onerror = (err) => {
      log.error('failed to connect to Roon; it may be offline, attempting to connect again...')
      setTimeout(() => this.tryDockerHostWsConnect(host, port), 5000)
    }
  }
}

// TODO: it might be better if the config.json location were a Roon 
// API option rather than setting the entire process's working dir.
function setWorkingDir(dir) {
  if (dir) {
    process.chdir(dir)
  }
}

function main() {
  // Note: the default value for the root arg is the BUILD_WORKSPACE_DIRECTORY env variable,
  // which is set by Bazel when running with 'bazel run'.
  program
    .version(version, '-v, --version')
    .option('-h, --host [host]', 'the host (including port number) on which to expose the Roon Bridge gRPC server', '0.0.0.0:50051')
    .option('-rl, --roon-log-level [roonLogLevel]', 'the log level for the Roon API client. Must be one of "none", "info", or "all"', 'none')
    .option('-l, --log-level [logLevel]', 'the log level for the gRPC server. Must be one of "debug", "info", "warn", "error", or "silent"', 'info')
    .option('-r, --root [dir]', 'the root directory that identifies the extension to Roon', process.env.BUILD_WORKSPACE_DIRECTORY)
    .option('--roon-host [roonHost]', 'the hostname to use for directly connecting to Roon instead of using UDP discovery. Must be specified along with --roon-port.')
    .option('--roon-port [roonPort]', 'the port number to use for directly connecting to Roon instead of using UDP discovery. Must be specified along with --roon-host.')
  program.parse(process.argv)
  const args = program.opts()
  
  log.setLevel(args.logLevel)
  var service = new RoonService()
  service.start(args)
}

main()
