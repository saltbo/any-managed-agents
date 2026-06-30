package runtime

import (
	"context"
	"testing"
	"time"
)

type recordingAdapter struct {
	request Request
}

func (a *recordingAdapter) Run(_ context.Context, request Request, _ EventWriter) (JSON, error) {
	a.request = request
	return JSON{"exitCode": 0}, nil
}

func TestRunnerUsesInjectedAdapter(t *testing.T) {
	adapter := &recordingAdapter{}
	result := (Runner{Adapter: adapter}).Run(context.Background(), Request{Runtime: "codex", SessionID: "session_1"}, nil)
	if result.Err != nil {
		t.Fatalf("expected run success, got %v", result.Err)
	}
	if adapter.request.SessionID != "session_1" {
		t.Fatalf("expected request to reach adapter, got %#v", adapter.request)
	}
	if result.Output["exitCode"] != 0 {
		t.Fatalf("unexpected result %#v", result.Output)
	}
}

type blockingAdapter struct{}

func (blockingAdapter) Run(ctx context.Context, _ Request, _ EventWriter) (JSON, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestRunnerReportsTimeout(t *testing.T) {
	result := (Runner{
		Adapter:            blockingAdapter{},
		MaxSessionDuration: time.Nanosecond,
	}).Run(context.Background(), Request{Runtime: "codex"}, nil)
	if !result.TimedOut {
		t.Fatalf("expected timed out result, got %#v", result)
	}
	if result.Err == nil {
		t.Fatal("expected timeout error")
	}
}

type writingAdapter struct{}

func (writingAdapter) Run(_ context.Context, _ Request, write EventWriter) (JSON, error) {
	if err := write(JSON{"type": "runtime.output", "payload": JSON{"content": "ok"}}); err != nil {
		return nil, err
	}
	return JSON{"exitCode": 0}, nil
}

func TestRunnerUsesNoopWriterWhenWriterIsNil(t *testing.T) {
	result := (Runner{Adapter: writingAdapter{}}).Run(context.Background(), Request{Runtime: "codex"}, nil)
	if result.Err != nil {
		t.Fatalf("expected noop writer to accept event, got %v", result.Err)
	}
}
