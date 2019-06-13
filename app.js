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
const grpc = require('grpc')
const protoLoader = require('@grpc/proto-loader')
const commander = require('commander')

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
function bridge(api, funcName, validateAndGetArgs, cbToResponse) {
  return function(call, callback) {
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
        callback({message: `Error: ${err}`, code: grpc.status.INTERNAL})
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

// RoonService implements gRPC handlers for all RPCs defined in roon.proto
class RoonService {
  corePaired(_core) {
    console.log('Paired with core', _core.display_name, _core.display_version)
    this.core = _core
    this.transportApi = _core.services.RoonApiTransport
    this.browseApi = _core.services.RoonApiBrowse
    this.imageApi = _core.services.RoonApiImage

    this.transportApi.subscribe_zones((response, msg) => {
      if (response === 'Subscribed') {
        this.zones = msg.zones.reduce((acc, z) => (acc[z.zone_id] = z) && acc, {})
      } else if (response === 'Changed') {
        if (msg.zones_removed) msg.zones_removed.forEach(z => delete(this.zones[z.zone_id]))
        if (msg.zones_added) msg.zones_added.forEach(z => this.zones[z.zone_id] = z)
        if (msg.zones_changed) msg.zones_changed.forEach(z => this.zones[z.zone_id] = z)
      } else if (response === 'Unsubscribed') {
        delete(this.zones)
      }
    })
    this.statusSvc.set_status('OK', false)
  }

  coreUnpaired(_core) {
    console.log('Core unpaired')
    this.statusSvc.set_status('No core paired', true)
    delete(this.core)
    delete(this.transportApi)
    delete(this.browseApi)
    delete(this.imageApi)
    delete(this.zones)
  }

  lookupZone(zoneId) {
    if (this.zones) {
      return this.zones[zoneId]
    }
  }

  lookupOutput(outputId) {
    var zones = this.zones
    if (zones) {
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
  }

  getZone(call, callback) {
    if (!this.core) { 
      callback(noCorePaired)
      return
    }
    var result = this.zones[call.request.zone_id]
    if (result) {
      callback(null, {zone: result})
    } else {
      callback({code: grpc.status.NOT_FOUND, message: `Zone ${call.request.zone_id} not found`})
    }
  }

  listAllZones(call, callback) {
    if (!this.core) { 
      callback(noCorePaired)
      return
    }
    var result = {zones: []}
    for (var key in this.zones) {
      if (this.zones.hasOwnProperty(key)) {
        result.zones.push(this.zones[key])
      }
    }
    callback(null, result)
  }

  // Browse APIs

  browse(call, callback) {
    bridge(this.browseApi, 'browse', req => {
      if (!req.hierarchy || req.hierarchy.endsWith('_unspecified')) {
        return {message: 'Must specify a valid hierarchy', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req]
    })(call, callback)
  }

  load(call, callback) {
    bridge(this.browseApi, 'load', req => {
      if (!req.hierarchy || req.hierarchy.endsWith('_unspecified')) {
        return {message: 'Must specify a valid hierarchy', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req]
    })(call, callback)
  }

  // Image APIs

  getImage(call, callback) {
    bridge(this.imageApi, 'get_image', req => {
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
    bridge(this.transportApi, 'change_settings', req => {
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
    bridge(this.transportApi, 'change_volume', req => {
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
    bridge(this.transportApi, 'control', req => {
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
    bridge(this.transportApi, 'convenience_switch', req => {
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
    bridge(this.transportApi, 'group_outputs', req => {
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
    bridge(this.transportApi, 'mute', req => {
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
    bridge(this.transportApi, 'mute_all', req => {
      if (!req.how || req.how.endsWith('_unspecified')) {
        return {message: 'Must specify a mute action', code: grpc.status.INVALID_ARGUMENT}
      }
      return [req.how]
    })(call, callback)
  }

  pauseAll(call, callback) {
    bridge(this.transportApi, 'pause_all', req => [])(call, callback)
  }

  seek(call, callback) {
    bridge(this.transportApi, 'seek', req => {
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
    bridge(this.transportApi, 'standby', req => {
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
    bridge(this.transportApi, 'toggle_standby', req => {
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
    bridge(this.transportApi, 'transfer_zone', req => {
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
    bridge(this.transportApi, 'ungroup_outputs', req => {
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
}

function startGRPCServer(roonService, args) {
  var roonProto = loadRoonProto()
  var server = new grpc.Server()
  var host = `0.0.0.0:${args.port}`
  console.log(`Starting gRPC server at ${host}`)
  server.addService(roonProto.RoonService.service, roonService)
  if (!server.bind(host, grpc.ServerCredentials.createInsecure())) {
    console.log(`Failed to bind to port ${args.port}`)
    process.exit(1)
  }
  server.start()
  console.log('Started gRPC server')
}

function startRoonDiscovery(roonService, args) {
  console.log('Starting Roon discovery')
  setWorkingDir(args.root)
  var roon = new RoonApi({
    extension_id:    'com.sambosley.grpc.roon',
    display_name:    'gRPC Bridge',
    display_version: version,
    publisher:       'Sam Bosley',
    email:           'sboz88@gmail.com',
    website:         'https://github.com/sbosley/roon-api-grpc-bridge',
    log_level:       args.logLevel,
    core_paired:     core => roonService.corePaired(core),
    core_unpaired:   core => roonService.coreUnpaired(core)
  })
  
  var statusSvc = new RoonApiStatus(roon)
  statusSvc.set_status("Pairing...", false)
  roonService.statusSvc = statusSvc

  roon.init_services({
    provided_services: [statusSvc],
    required_services: [RoonApiTransport, RoonApiBrowse, RoonApiImage]
  })
  if (args.dockerMac) {
    // Docker for Mac has trouble with UDP discovery, so just attempt
    // to connect directly in this case.
    tryDockerHostWsConnect(roon, 0)
  } else {
    roon.start_discovery()
  }
}

function tryDockerHostWsConnect(roon, attempts) {
  if (attempts >= 10) {
    console.log('failed to connect after 10 attempts; stopping extension')
    process.exit(1)
  } else {
    roon.ws_connect({host: 'host.docker.internal', port: 9100, onclose: () => {
      console.log('lost Roon connection, attempting to connect again...')
      setTimeout(() => tryDockerHostWsConnect(roon, attempts + 1), 5000)
    }})
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
  var args = commander
    .version(version, '-v, --version')
    .option('-p, --port [port]', 'the port on which to expose the Roon Bridge gRPC server', s => parseInt(s, 10), 50051)
    .option('-l, --log-level [logLevel]', 'the log level for the Roon API client. Must be one of "none", "info", or "all"', 'none')
    .option('-r, --root [dir]', 'the root directory that identifies the extension to Roon', process.env.BUILD_WORKSPACE_DIRECTORY)
    .option('--docker-mac', 'indicates if the container is running in docker for Mac, which requires bypassing service discovery')
    .parse(process.argv)
  
  var service = new RoonService()
  startGRPCServer(service, args)
  startRoonDiscovery(service, args)
}

main()
