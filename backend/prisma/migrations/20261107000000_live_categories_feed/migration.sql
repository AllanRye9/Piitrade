-- Live change feed, part 2: categories (and open jobs) now announce changes too.
--
-- Part 1 (20261105000000_live_change_feed) covered listings, photos and clicks. Category edits made by an
-- admin (rename, reorder, retire, move, new subcategory) and job posts opening/closing change what the
-- category menus, the home page icons and every item count show, but nothing announced them, so open
-- pages kept the old numbers until their cache expired.
--
-- Same rules as before: the payload is only a topic name, never row data. Counters / bookkeeping columns
-- are ignored so ordinary traffic does not wake every open page.
--
--   categories  menus, category pages, category tiles (also refreshes item counts)
--   listings    item counts and lists (job posts feed the "Jobs" count)

DROP TRIGGER IF EXISTS live_category_ins_del ON "Category";
CREATE TRIGGER live_category_ins_del
  AFTER INSERT OR DELETE ON "Category"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed('categories,listings');

DROP TRIGGER IF EXISTS live_category_upd ON "Category";
CREATE TRIGGER live_category_upd
  AFTER UPDATE ON "Category"
  FOR EACH ROW
  WHEN (
    (OLD."name", OLD."slug", OLD."icon", OLD."parentId", OLD."sortOrder", OLD."shortName", OLD."menuGroup", OLD."isActive", OLD."fieldSchema"::text)
    IS DISTINCT FROM
    (NEW."name", NEW."slug", NEW."icon", NEW."parentId", NEW."sortOrder", NEW."shortName", NEW."menuGroup", NEW."isActive", NEW."fieldSchema"::text)
  )
  EXECUTE FUNCTION notify_data_changed('categories,listings');

-- Open job posts are part of the "Jobs" item count.
DROP TRIGGER IF EXISTS live_jobpost_ins_del ON "JobPost";
CREATE TRIGGER live_jobpost_ins_del
  AFTER INSERT OR DELETE ON "JobPost"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed('listings');

DROP TRIGGER IF EXISTS live_jobpost_upd ON "JobPost";
CREATE TRIGGER live_jobpost_upd
  AFTER UPDATE ON "JobPost"
  FOR EACH ROW
  WHEN ((OLD."status", OLD."country") IS DISTINCT FROM (NEW."status", NEW."country"))
  EXECUTE FUNCTION notify_data_changed('listings');
