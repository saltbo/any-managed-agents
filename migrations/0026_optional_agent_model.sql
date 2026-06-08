PRAGMA writable_schema=ON;

UPDATE sqlite_master
SET sql = replace(replace(sql, '`model` text NOT NULL', '`model` text'), 'model TEXT NOT NULL', 'model TEXT')
WHERE type = 'table'
  AND name IN ('agent_definitions', 'agent_definition_versions');

PRAGMA writable_schema=OFF;
