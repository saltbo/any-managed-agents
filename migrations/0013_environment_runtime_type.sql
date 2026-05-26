ALTER TABLE environments ADD COLUMN runtime_type TEXT NOT NULL DEFAULT 'cloud-hosted';
ALTER TABLE environment_versions ADD COLUMN runtime_type TEXT NOT NULL DEFAULT 'cloud-hosted';

UPDATE environments
SET network_policy = json_set(network_policy, '$.mode', 'unrestricted')
WHERE json_extract(network_policy, '$.mode') IS NULL
   OR json_extract(network_policy, '$.mode') = 'open'
   OR (
     json_extract(network_policy, '$.mode') = 'restricted'
     AND (
       COALESCE(json_type(network_policy, '$.allowedHosts'), '') != 'array'
       OR COALESCE(json_array_length(network_policy, '$.allowedHosts'), 0) = 0
       OR EXISTS (
         SELECT 1
         FROM json_each(network_policy, '$.allowedHosts')
         WHERE json_each.value != lower(json_each.value)
            OR json_each.value GLOB '*[:/]*'
       )
     )
   );

UPDATE environment_versions
SET network_policy = json_set(network_policy, '$.mode', 'unrestricted')
WHERE json_extract(network_policy, '$.mode') IS NULL
   OR json_extract(network_policy, '$.mode') = 'open'
   OR (
     json_extract(network_policy, '$.mode') = 'restricted'
     AND (
       COALESCE(json_type(network_policy, '$.allowedHosts'), '') != 'array'
       OR COALESCE(json_array_length(network_policy, '$.allowedHosts'), 0) = 0
       OR EXISTS (
         SELECT 1
         FROM json_each(network_policy, '$.allowedHosts')
         WHERE json_each.value != lower(json_each.value)
            OR json_each.value GLOB '*[:/]*'
       )
     )
   );

UPDATE sessions
SET environment_snapshot = json_set(environment_snapshot, '$.runtimeType', 'cloud-hosted')
WHERE environment_snapshot IS NOT NULL
  AND json_extract(environment_snapshot, '$.runtimeType') IS NULL;

UPDATE sessions
SET environment_snapshot = json_set(environment_snapshot, '$.networkPolicy.mode', 'unrestricted')
WHERE environment_snapshot IS NOT NULL
  AND (
    json_extract(environment_snapshot, '$.networkPolicy.mode') IS NULL
    OR json_extract(environment_snapshot, '$.networkPolicy.mode') = 'open'
    OR (
      json_extract(environment_snapshot, '$.networkPolicy.mode') = 'restricted'
      AND (
        COALESCE(json_type(environment_snapshot, '$.networkPolicy.allowedHosts'), '') != 'array'
        OR COALESCE(json_array_length(environment_snapshot, '$.networkPolicy.allowedHosts'), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM json_each(environment_snapshot, '$.networkPolicy.allowedHosts')
          WHERE json_each.value != lower(json_each.value)
             OR json_each.value GLOB '*[:/]*'
        )
      )
    )
  );
