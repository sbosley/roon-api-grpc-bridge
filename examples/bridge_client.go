package main

import (
	"context"
	"io"
	"log"

	"github.com/golang/protobuf/proto"
	"google.golang.org/grpc"

	pb "github.com/sbosley/roon-api-grpc-bridge/protos/roon_go_proto"
)

func main() {
	conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
	if err != nil {
		log.Fatalf("failed to connect to server: %v", err)
	}
	defer conn.Close()

	client := pb.NewRoonServiceClient(conn)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	zones, err := client.ListAllZones(ctx, &pb.ListAllZonesRequest{})
	if err != nil {
		log.Fatalf("ListAllZonesFailed: %v", err)
	}
	log.Printf("Zones:\n%s", proto.MarshalTextString(zones))

	zone, err := client.GetZone(ctx, &pb.GetZoneRequest{ZoneId: zones.Zones[0].ZoneId})
	if err != nil {
		log.Fatalf("GetZone failed: %v", err)
	}
	log.Printf("Zone:\n%s", proto.MarshalTextString(zone))

	playFirstAlbum(ctx, client, zone.Zone.ZoneId)

	receiver, err := client.SubscribeZones(ctx, &pb.SubscribeZonesRequest{})
	if err != nil {
		log.Fatalf("SubscribeZone failed: %v", err)
	}
	for i := 1; i <= 10; i++ {
		log.Printf("Receiving zones stream: %d", i)
		resp, err := receiver.Recv()
		if err == io.EOF {
			log.Printf("Got EOF")
			break
		} else if err != nil {
			log.Fatalf("Got err receiving stream: %v", err)
		}
		log.Printf("Resp:\n%s", proto.MarshalTextString(resp))
	}
}

// Demo of using browse and list APIs to play the first album in the album list programmatically
func playFirstAlbum(ctx context.Context, c pb.RoonServiceClient, zoneID string) {
	browseAlbums := &pb.BrowseRequest{
		Hierarchy: pb.BrowseHierarchy_albums,
		PopAll:    true,
	}
	resp := browseAndLoadList(ctx, c, browseAlbums)

	browseAlbum0 := &pb.BrowseRequest{
		Hierarchy: pb.BrowseHierarchy_albums,
		ItemKey:   resp.Items[0].ItemKey,
	}
	resp = browseAndLoadList(ctx, c, browseAlbum0)

	browseItemActions := &pb.BrowseRequest{
		Hierarchy: pb.BrowseHierarchy_albums,
		ItemKey:   resp.Items[0].ItemKey,
	}
	resp = browseAndLoadList(ctx, c, browseItemActions)

	playAlbum := &pb.BrowseRequest{
		Hierarchy:      pb.BrowseHierarchy_albums,
		ItemKey:        resp.Items[0].ItemKey,
		ZoneOrOutputId: zoneID,
	}
	_, err := c.Browse(ctx, playAlbum)
	if err != nil {
		log.Fatalf("Browse req %v failed to play album: %v", proto.MarshalTextString(playAlbum), err)
	}
}

// Browse and load a single list in the browse hierarchy. Suppresses any errors and exits the program for demo
// purposes instead of doing real error handling.
func browseAndLoadList(ctx context.Context, c pb.RoonServiceClient, browse *pb.BrowseRequest) *pb.LoadResponse {
	browseResp, err := c.Browse(ctx, browse)
	if err != nil {
		log.Fatalf("Browse req %v failed: %v", proto.MarshalTextString(browse), err)
	}
	if browseResp.Action != pb.BrowseAction_list || browseResp.List == nil {
		log.Fatalf("cannot load non-list browse response %+v", proto.MarshalTextString(browseResp))
	}

	loadReq := &pb.LoadRequest{
		Hierarchy: browse.Hierarchy,
		Count:     browseResp.List.Count,
	}
	loadResp, err := c.Load(ctx, loadReq)
	if err != nil {
		log.Fatalf("Load req %v failed: %v", proto.MarshalTextString(loadReq), err)
	}
	return loadResp
}
