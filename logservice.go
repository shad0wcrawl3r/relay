package main

import (
	"errors"
	"slices"

	"github.com/shad0wcrawl3r/relay/internal/config"
	"github.com/shad0wcrawl3r/relay/internal/logs"
)

// LogService lets Settings turn logging on, set each subsystem's level and read
// the entries held in memory.
type LogService struct{}

type LogSubsystem struct {
	logs.Subsystem
	Level string `json:"level"`
}

type LogStatus struct {
	Enabled    bool           `json:"enabled"`
	Subsystems []LogSubsystem `json:"subsystems"`
}

func (s *LogService) Status() LogStatus {
	levels := logs.Levels()
	st := LogStatus{Enabled: logs.Enabled(), Subsystems: []LogSubsystem{}}
	for _, sub := range logs.Subsystems {
		st.Subsystems = append(st.Subsystems, LogSubsystem{Subsystem: sub, Level: levels[sub.ID]})
	}
	return st
}

func (s *LogService) apply(enabled bool, levels map[string]string) (LogStatus, error) {
	err := config.Update(func(c *config.Config) {
		c.Logs.Enabled, c.Logs.Levels = enabled, levels
	})
	if err != nil {
		return LogStatus{}, err
	}
	logs.Configure(enabled, levels)
	return s.Status(), nil
}

// SetEnabled turns logging on or off.
func (s *LogService) SetEnabled(enabled bool) (LogStatus, error) {
	return s.apply(enabled, logs.Levels())
}

// SetLevel changes one subsystem's level.
func (s *LogService) SetLevel(subsystem, level string) (LogStatus, error) {
	known := slices.ContainsFunc(logs.Subsystems, func(sub logs.Subsystem) bool { return sub.ID == subsystem })
	if _, ok := logs.ParseLevel(level); !ok || !known {
		return LogStatus{}, errors.New("unknown subsystem or level")
	}
	levels := logs.Levels()
	levels[subsystem] = level
	return s.apply(logs.Enabled(), levels)
}

// Entries returns those newer than seq, oldest first.
func (s *LogService) Entries(after uint64) []logs.Entry {
	return logs.Entries(after)
}

// Clear empties the log.
func (s *LogService) Clear() {
	logs.Clear()
}
