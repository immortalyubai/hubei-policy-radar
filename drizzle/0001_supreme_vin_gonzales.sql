DROP INDEX `sources_type_url_unique`;--> statement-breakpoint
CREATE INDEX `sources_type_url_idx` ON `sources` (`source_type`,`entry_url`);