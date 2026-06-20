from enum import Enum

class SessionEventType(str, Enum):
    AGENT_END = "agent_end"
    AGENT_START = "agent_start"
    MESSAGE_END = "message_end"
    MESSAGE_START = "message_start"
    MESSAGE_UPDATE = "message_update"
    PERMISSION_REQUEST = "permission.request"
    POLICY_DECISION = "policy.decision"
    RUNNER_METADATA = "runner.metadata"
    RUNTIME_ERROR = "runtime.error"
    RUNTIME_METADATA = "runtime.metadata"
    RUNTIME_OUTPUT = "runtime.output"
    SESSION_CHECKPOINT = "session_checkpoint"
    SESSION_RESUME = "session_resume"
    SESSION_STOP = "session_stop"
    TOOL_EXECUTION_END = "tool_execution_end"
    TOOL_EXECUTION_START = "tool_execution_start"
    TOOL_EXECUTION_UPDATE = "tool_execution_update"
    TURN_END = "turn_end"
    TURN_START = "turn_start"
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
