ALTER TABLE environments RENAME COLUMN runtime_type TO hosting_mode;
ALTER TABLE environments RENAME COLUMN runtime_image TO runtime_config;
ALTER TABLE environments ADD COLUMN runtime TEXT NOT NULL DEFAULT 'ama';

UPDATE environments
SET hosting_mode = CASE hosting_mode
  WHEN 'cloud-hosted' THEN 'cloud'
  WHEN 'self-hosted' THEN 'self_hosted'
  ELSE hosting_mode
END;

ALTER TABLE environment_versions RENAME COLUMN runtime_type TO hosting_mode;
ALTER TABLE environment_versions RENAME COLUMN runtime_image TO runtime_config;
ALTER TABLE environment_versions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'ama';

UPDATE environment_versions
SET hosting_mode = CASE hosting_mode
  WHEN 'cloud-hosted' THEN 'cloud'
  WHEN 'self-hosted' THEN 'self_hosted'
  ELSE hosting_mode
END;

CREATE TABLE environment_runtime_contract_check (
  hosting_mode TEXT NOT NULL CHECK (hosting_mode IN ('cloud', 'self_hosted')),
  runtime TEXT NOT NULL CHECK (runtime IN ('ama', 'claude-code', 'codex', 'copilot'))
);

INSERT INTO environment_runtime_contract_check (hosting_mode, runtime)
SELECT hosting_mode, runtime FROM environments;

INSERT INTO environment_runtime_contract_check (hosting_mode, runtime)
SELECT hosting_mode, runtime FROM environment_versions;

DROP TABLE environment_runtime_contract_check;

UPDATE sessions
SET environment_snapshot = json_remove(
  json_set(
    json_set(
      json_set(
        environment_snapshot,
        '$.hostingMode',
        CASE json_extract(environment_snapshot, '$.runtimeType')
          WHEN 'self-hosted' THEN 'self_hosted'
          ELSE 'cloud'
        END
      ),
      '$.runtime',
      COALESCE(json_extract(environment_snapshot, '$.runtime'), 'ama')
    ),
    '$.runtimeConfig',
    json(COALESCE(json_extract(environment_snapshot, '$.runtimeConfig'), json_extract(environment_snapshot, '$.runtimeImage'), '{}'))
  ),
  '$.runtimeType',
  '$.runtimeImage'
)
WHERE environment_snapshot IS NOT NULL;

UPDATE sessions
SET metadata = json_remove(
  json_set(
    json_set(
      json_set(
        json_set(
          metadata,
          '$.hostingMode',
          CASE json_extract(metadata, '$.runtimeType')
            WHEN 'self-hosted' THEN 'self_hosted'
            ELSE COALESCE(json_extract(metadata, '$.hostingMode'), 'cloud')
          END
        ),
        '$.runtime',
        CASE json_extract(metadata, '$.runtime')
          WHEN 'ama-cloud' THEN 'ama'
          ELSE COALESCE(json_extract(metadata, '$.runtime'), 'ama')
        END
      ),
      '$.runtimeBackend',
      CASE
        WHEN json_extract(metadata, '$.runtime') = 'ama-cloud' THEN 'ama-cloud'
        ELSE COALESCE(json_extract(metadata, '$.runtimeBackend'), 'ama-cloud')
      END
    ),
    '$.runtimeProtocol',
    COALESCE(
      json_extract(metadata, '$.runtimeProtocol'),
      json_extract(metadata, '$.protocol'),
      CASE json_extract(metadata, '$.runtime')
        WHEN 'ama-cloud' THEN 'ama-runtime-rpc'
        ELSE NULL
      END
    )
  ),
  '$.runtimeType',
  '$.protocol'
)
WHERE metadata IS NOT NULL
  AND (
    json_extract(metadata, '$.runtimeType') IS NOT NULL
    OR json_extract(metadata, '$.runtime') = 'ama-cloud'
    OR json_extract(metadata, '$.protocol') IS NOT NULL
  );
