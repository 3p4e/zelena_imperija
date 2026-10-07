ALTER TABLE "providers" ADD COLUMN "category" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;
