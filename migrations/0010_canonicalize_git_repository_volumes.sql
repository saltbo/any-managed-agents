-- Canonicalize repository volumes to the platform-neutral Git shape:
-- { type: "git_repository", url: "https://github.com/{owner}/{repo}.git" }.

UPDATE `sessions`
SET `volumes` = COALESCE(
  (
    SELECT json_group_array(
      CASE
        WHEN json_extract(`item`.`value`, '$.type') = 'github_repository'
          THEN json_set(
            json_remove(json(`item`.`value`), '$.owner', '$.repo', '$.credentialRef'),
            '$.type',
            'git_repository',
            '$.url',
            printf(
              'https://github.com/%s/%s.git',
              json_extract(`item`.`value`, '$.owner'),
              json_extract(`item`.`value`, '$.repo')
            )
          )
        ELSE json(`item`.`value`)
      END
    )
    FROM json_each(`sessions`.`volumes`) AS `item`
  ),
  `volumes`
)
WHERE `volumes` LIKE '%github_repository%'
  AND json_valid(`volumes`);--> statement-breakpoint

UPDATE `triggers`
SET `volumes` = COALESCE(
  (
    SELECT json_group_array(
      CASE
        WHEN json_extract(`item`.`value`, '$.type') = 'github_repository'
          THEN json_set(
            json_remove(json(`item`.`value`), '$.owner', '$.repo', '$.credentialRef'),
            '$.type',
            'git_repository',
            '$.url',
            printf(
              'https://github.com/%s/%s.git',
              json_extract(`item`.`value`, '$.owner'),
              json_extract(`item`.`value`, '$.repo')
            )
          )
        ELSE json(`item`.`value`)
      END
    )
    FROM json_each(`triggers`.`volumes`) AS `item`
  ),
  `volumes`
)
WHERE `volumes` LIKE '%github_repository%'
  AND json_valid(`volumes`);
