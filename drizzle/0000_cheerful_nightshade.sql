CREATE TABLE `item_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text,
	`original_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`source_title` text NOT NULL,
	`source_publisher` text NOT NULL,
	`published_at` text,
	`discovered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`content_hash` text,
	`content_text` text,
	`is_official` integer DEFAULT false NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`match_type` text DEFAULT 'new' NOT NULL,
	`match_confidence` integer DEFAULT 100 NOT NULL,
	`evidence_status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_sources_canonical_url_unique` ON `item_sources` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_sources_external_unique` ON `item_sources` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `item_sources_item_primary_idx` ON `item_sources` (`item_id`,`is_primary`);--> statement-breakpoint
CREATE INDEX `item_sources_hash_idx` ON `item_sources` (`content_hash`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`document_number` text,
	`item_type` text NOT NULL,
	`region_code` text DEFAULT '420000' NOT NULL,
	`region_name` text DEFAULT '湖北省' NOT NULL,
	`city_name` text,
	`publisher_name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`application_targets` text,
	`benefits` text,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`published_at` text NOT NULL,
	`effective_at` text,
	`deadline_at` text,
	`lifecycle_status` text DEFAULT 'unknown' NOT NULL,
	`verification_status` text DEFAULT 'pending_official' NOT NULL,
	`verified_at` text,
	`primary_url` text NOT NULL,
	`primary_source_type` text NOT NULL,
	`primary_source_name` text NOT NULL,
	`source_count` integer DEFAULT 1 NOT NULL,
	`score` integer DEFAULT 50 NOT NULL,
	`screening_reason` text DEFAULT '' NOT NULL,
	`discovered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_dedupe_key_unique` ON `items` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `items_region_published_idx` ON `items` (`region_code`,`published_at`);--> statement-breakpoint
CREATE INDEX `items_type_deadline_idx` ON `items` (`item_type`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `items_verification_discovered_idx` ON `items` (`verification_status`,`discovered_at`);--> statement-breakpoint
CREATE INDEX `items_document_number_idx` ON `items` (`document_number`);--> statement-breakpoint
CREATE TABLE `source_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`http_status` integer,
	`latency_ms` integer,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_runs_source_started_idx` ON `source_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `source_runs_status_started_idx` ON `source_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`region_code` text DEFAULT '420000' NOT NULL,
	`publisher_name` text NOT NULL,
	`entry_url` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`poll_interval_minutes` integer DEFAULT 120 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`health_status` text DEFAULT 'healthy' NOT NULL,
	`last_checked_at` text,
	`last_success_at` text,
	`last_error_at` text,
	`last_error_message` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_type_url_unique` ON `sources` (`source_type`,`entry_url`);--> statement-breakpoint
CREATE INDEX `sources_active_priority_idx` ON `sources` (`is_active`,`priority`);--> statement-breakpoint
CREATE INDEX `sources_region_type_idx` ON `sources` (`region_code`,`source_type`);