ALTER TABLE agent_definitions ADD COLUMN model_optional TEXT;
UPDATE agent_definitions SET model_optional = model;
ALTER TABLE agent_definitions DROP COLUMN model;
ALTER TABLE agent_definitions RENAME COLUMN model_optional TO model;

ALTER TABLE agent_definition_versions ADD COLUMN model_optional TEXT;
UPDATE agent_definition_versions SET model_optional = model;
ALTER TABLE agent_definition_versions DROP COLUMN model;
ALTER TABLE agent_definition_versions RENAME COLUMN model_optional TO model;
