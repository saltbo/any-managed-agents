from enum import Enum

class ListSessionEventsType(str, Enum):
    AGENT_COMPLETED = "agent.completed"
    AGENT_STARTED = "agent.started"
    MESSAGE_COMPLETED = "message.completed"
    MESSAGE_STARTED = "message.started"
    MESSAGE_UPDATED = "message.updated"
    PERMISSION_DENIED = "permission.denied"
    PERMISSION_REQUESTED = "permission.requested"
    PERMISSION_RESOLVED = "permission.resolved"
    RUNNER_STATUS = "runner.status"
    RUNTIME_ERROR = "runtime.error"
    RUNTIME_OUTPUT = "runtime.output"
    RUNTIME_STATUS = "runtime.status"
    SESSION_CHECKPOINTED = "session.checkpointed"
    SESSION_RESUMED = "session.resumed"
    SESSION_STOPPED = "session.stopped"
    TOOL_CALL_COMPLETED = "tool_call.completed"
    TOOL_CALL_STARTED = "tool_call.started"
    TOOL_CALL_UPDATED = "tool_call.updated"
    TURN_COMPLETED = "turn.completed"
    TURN_STARTED = "turn.started"
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
