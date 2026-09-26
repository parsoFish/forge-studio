package main

import (
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6/tf6server"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops"
)

// version is set by the GoReleaser build via -ldflags "-X main.version=...".
// It defaults to "dev" for local builds.
var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers like delve")
	flag.Parse()

	var serveOpts []tf6server.ServeOpt
	if debug {
		serveOpts = append(serveOpts, tf6server.WithManagedDebug())
	}

	err := tf6server.Serve(
		"registry.terraform.io/parsoFish/betterado",
		providerserver.NewProtocol6(azuredevops.NewFrameworkProvider(version)),
		serveOpts...,
	)
	if err != nil {
		log.Fatal(err)
	}
}
