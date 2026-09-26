package client

import (
	"testing"

	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/pipelinesapproval"
)

// TestPipelinesApprovalClient verifies that AggregatedClient declares the
// PipelinesApprovalClient field of the correct interface type.  This is a
// compile-time / struct-shape test: if the field is missing or wrong type the
// test file won't compile and the gate fails with a build error.
func TestPipelinesApprovalClient(t *testing.T) {
	t.Run("AggregatedClient has PipelinesApprovalClient field of pipelinesapproval.Client type", func(t *testing.T) {
		// Declare a nil-value of the interface type and assign it to the struct
		// field to confirm the type is compatible — no network calls needed.
		var c pipelinesapproval.Client
		ac := &AggregatedClient{
			PipelinesApprovalClient: c,
		}
		if ac.PipelinesApprovalClient != nil {
			t.Fatal("expected nil client, got non-nil")
		}
	})
}
