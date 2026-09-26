// Package-level fork note:
// This file is part of a local fork of github.com/microsoft/azure-devops-go-api/azuredevops/v7
// (sourced via github.com/magodo/azure-devops-go-api/azuredevops/v7). The fork exists solely to
// carry this patch file. ADO's release API emits "daysToRelease" as a JSON integer bitmask
// (0–127), but the upstream SDK models the field as *ScheduleDays (a Go string alias). Neither
// the upstream microsoft repo nor the magodo fork has fixed this; their json.Unmarshal fails at
// runtime with "cannot unmarshal number into ... type release.ScheduleDays". A hand-patch in
// vendor/ was the original workaround, but `go mod vendor` deletes files it didn't generate,
// causing CI depscheck failures. The local replace directive (go.mod: replace ... => ./third_party/...)
// makes `go mod vendor` regenerate this file deterministically from third_party/, so the patch
// survives CI.

package release

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"
)

// UnmarshalJSON implements custom JSON deserialization for ReleaseSchedule.
//
// The ADO REST API returns "daysToRelease" as a JSON number (integer bitmask,
// 0–127) in GET responses, but the SDK models it as *ScheduleDays (a Go string
// type). Standard json.Unmarshal fails with "cannot unmarshal number into Go
// struct field ReleaseSchedule.daysToRelease of type release.ScheduleDays".
//
// This custom unmarshaler reads the raw JSON and coerces the numeric value to
// a ScheduleDays string so the rest of the code can work with it normally.
func (s *ReleaseSchedule) UnmarshalJSON(data []byte) error {
	// Use a temporary struct with DaysToRelease as json.Number (accepts both
	// string and number tokens without failing).
	type Alias struct {
		DaysToRelease           json.Number `json:"daysToRelease,omitempty"`
		JobId                   *uuid.UUID  `json:"jobId,omitempty"`
		ScheduleOnlyWithChanges *bool       `json:"scheduleOnlyWithChanges,omitempty"`
		StartHours              *int        `json:"startHours,omitempty"`
		StartMinutes            *int        `json:"startMinutes,omitempty"`
		TimeZoneId              *string     `json:"timeZoneId,omitempty"`
	}

	var alias Alias
	if err := json.Unmarshal(data, &alias); err != nil {
		return fmt.Errorf("ReleaseSchedule.UnmarshalJSON: %w", err)
	}

	s.JobId = alias.JobId
	s.ScheduleOnlyWithChanges = alias.ScheduleOnlyWithChanges
	s.StartHours = alias.StartHours
	s.StartMinutes = alias.StartMinutes
	s.TimeZoneId = alias.TimeZoneId

	if alias.DaysToRelease != "" {
		sd := ScheduleDays(alias.DaysToRelease.String())
		s.DaysToRelease = &sd
	}

	return nil
}

// MarshalJSON implements custom JSON serialization for ReleaseSchedule.
//
// The ADO REST API expects "daysToRelease" as a JSON integer (bitmask 0–127).
// Without this override the SDK's *ScheduleDays (a Go string type) would marshal
// to a JSON string (e.g. "62"), which ADO silently ignores or rejects.
// We convert the string representation back to an integer token so the
// create/update request payload matches what ADO expects.
func (s ReleaseSchedule) MarshalJSON() ([]byte, error) {
	// Build a raw map so we have full control over each field's JSON type.
	m := map[string]interface{}{}

	if s.DaysToRelease != nil {
		str := string(*s.DaysToRelease)
		if n, err := strconv.Atoi(str); err == nil {
			// Numeric string (e.g. "62") → emit as JSON integer.
			m["daysToRelease"] = n
		} else {
			// Named enum value (e.g. "monday") → emit as JSON string.
			m["daysToRelease"] = str
		}
	}
	if s.JobId != nil {
		m["jobId"] = s.JobId
	}
	if s.ScheduleOnlyWithChanges != nil {
		m["scheduleOnlyWithChanges"] = *s.ScheduleOnlyWithChanges
	}
	if s.StartHours != nil {
		m["startHours"] = *s.StartHours
	}
	if s.StartMinutes != nil {
		m["startMinutes"] = *s.StartMinutes
	}
	if s.TimeZoneId != nil {
		m["timeZoneId"] = *s.TimeZoneId
	}

	return json.Marshal(m)
}
