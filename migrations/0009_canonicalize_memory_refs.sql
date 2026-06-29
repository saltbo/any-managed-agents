-- Canonicalize memory volumes to the resource-reference shape used by the
-- session entity: { type: "memory", memoryRef: "ama://memories/{storeId}" }.

UPDATE `sessions`
SET `volumes` = COALESCE(
  (
    SELECT json_group_array(
      CASE
        WHEN json_extract(`item`.`value`, '$.type') = 'memory_store'
          THEN json_set(
            json_remove(json(`item`.`value`), '$.storeId'),
            '$.type',
            'memory',
            '$.memoryRef',
            printf('ama://memories/%s', json_extract(`item`.`value`, '$.storeId'))
          )
        ELSE json(`item`.`value`)
      END
    )
    FROM json_each(`sessions`.`volumes`) AS `item`
  ),
  `volumes`
)
WHERE `volumes` LIKE '%memory_store%'
  AND json_valid(`volumes`);--> statement-breakpoint

UPDATE `triggers`
SET `volumes` = COALESCE(
  (
    SELECT json_group_array(
      CASE
        WHEN json_extract(`item`.`value`, '$.type') = 'memory_store'
          THEN json_set(
            json_remove(json(`item`.`value`), '$.storeId'),
            '$.type',
            'memory',
            '$.memoryRef',
            printf('ama://memories/%s', json_extract(`item`.`value`, '$.storeId'))
          )
        ELSE json(`item`.`value`)
      END
    )
    FROM json_each(`triggers`.`volumes`) AS `item`
  ),
  `volumes`
)
WHERE `volumes` LIKE '%memory_store%'
  AND json_valid(`volumes`);
