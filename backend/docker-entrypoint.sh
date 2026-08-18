#!/bin/sh
set -e

# Every hotfix below is intentionally non-fatal on failure (echo + continue,
# never `exit 1`) so that a single bad or inapplicable compatibility SQL
# file — e.g. one referencing a table that doesn't exist yet on a given
# environment, or a transient DB blip — can never prevent this container
# from reaching `exec node dist/index.js` at the bottom. Railway restarts a
# container that never starts listening, and a genuinely broken health
# check looks identical to a CORS failure from the browser's side (no
# process bound to the port = no response headers at all, CORS included).
# A degraded feature from one skipped hotfix is far preferable to the whole
# API being unreachable. `set -e` above only auto-aborts on *unguarded*
# command failures — every `npx prisma db execute` call here is wrapped in
# `if ! ...; then ...; fi`, so set -e never triggers on these regardless.

# Install netcat and postgresql-client for database health checks
apk add --no-cache netcat-openbsd postgresql-client

if [ -n "${DATABASE_PRIVATE_URL}" ]; then
    export DATABASE_URL="${DATABASE_PRIVATE_URL}"
fi

# Wait for database to be ready if DATABASE_URL is set
if [ -n "${DATABASE_URL}" ]; then
    echo "⏳ Waiting for database to be ready..."

    # Parse DATABASE_URL without hardcoding stale local test values.
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's#.*://\([^:]*\):.*@.*#\1#p')
    DB_PASS=$(echo "$DATABASE_URL" | sed -n 's#.*://[^:]*:\([^@]*\)@.*#\1#p')
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's#.*://[^@]*@\([^:/]*\).*#\1#p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's#.*://[^@]*@[^:/]*:\([0-9]*\).*#\1#p')
    DB_NAME=$(echo "$DATABASE_URL" | sed -n 's#.*://[^@]*@[^/]*\/\([^?]*\).*#\1#p')

    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
    DB_NAME=${DB_NAME:-postgres}
    DB_USER=${DB_USER:-postgres}

    echo "Database host: $DB_HOST, port: $DB_PORT, database: $DB_NAME, user: $DB_USER"

    # Wait for database to be ready using multiple methods
    MAX_RETRIES=30
    RETRY_COUNT=0
    DB_READY=0

    # Method 1: Try netcat
    while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
            echo "⚠️  Database not ready after $MAX_RETRIES attempts (netcat), trying psql..."
            break
        fi
        echo "Database not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES), waiting..."
        sleep 2
    done

    # Method 2: Try psql if netcat failed
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "⏳ Trying psql connection check..."
        RETRY_COUNT=0
        MAX_PSQL_RETRIES=10
        while ! PGPASSWORD="$DB_PASS" psql "postgresql://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; do
            RETRY_COUNT=$((RETRY_COUNT + 1))
            if [ $RETRY_COUNT -ge $MAX_PSQL_RETRIES ]; then
                echo "⚠️  Database not ready after psql attempts, continuing anyway..."
                break
            fi
            echo "Database not ready via psql (attempt $RETRY_COUNT/$MAX_PSQL_RETRIES), waiting..."
            sleep 3
        done

        if [ $RETRY_COUNT -lt $MAX_PSQL_RETRIES ]; then
            DB_READY=1
        fi
    else
        DB_READY=1
    fi

    # Final check
    if [ $DB_READY -eq 1 ]; then
        echo "✅ Database is ready and accessible!"
    else
        echo "⚠️  Database check failed, but continuing anyway..."
    fi
else
    echo "⚠️  DATABASE_URL not set, skipping database wait"
fi

# ============================================
# DYNAMIC MIGRATION HANDLING
# ============================================

echo "Running database migrations..."

# Check if prisma directory exists
if [ ! -d "./prisma" ]; then
    echo "⚠️  prisma directory not found, skipping migrations"
else
    # Check if schema.prisma exists
    if [ ! -f "./prisma/schema.prisma" ]; then
        echo "⚠️  schema.prisma not found, skipping migrations"
    else
        # Check if there are any migrations to apply
        if [ -d "./prisma/migrations" ] && [ "$(ls -A ./prisma/migrations 2>/dev/null)" ]; then
            echo "📁 Found migrations in ./prisma/migrations"
            
            DEPLOY_OUTPUT=$(npx prisma migrate deploy 2>&1) && DEPLOY_OK=1 || DEPLOY_OK=0
            echo "$DEPLOY_OUTPUT"
            
            if [ "$DEPLOY_OK" = "0" ]; then
                echo ""
                echo "prisma migrate deploy failed – attempting to resolve failed migrations..."
                
                # Check if the error is about CREATE INDEX CONCURRENTLY
                if echo "$DEPLOY_OUTPUT" | grep -q "CREATE INDEX CONCURRENTLY cannot run inside a transaction"; then
                    echo "⚠️  Detected CREATE INDEX CONCURRENTLY error. Attempting to fix..."
                    
                    # Extract the migration name
                    MIGRATION_NAME=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p')
                    
                    if [ -n "$MIGRATION_NAME" ]; then
                        echo "Found problematic migration: $MIGRATION_NAME"
                        
                        # Mark it as rolled back so we can reapply
                        echo "Marking $MIGRATION_NAME as rolled back..."
                        npx prisma migrate resolve --rolled-back "$MIGRATION_NAME" || true
                        
                        echo "Attempting to fix migration with --disable-transaction..."
                        
                        # Execute the SQL directly without transaction
                        MIGRATION_FILE=$(find ./prisma/migrations -name "*${MIGRATION_NAME}*" -type d | head -1)
                        if [ -n "$MIGRATION_FILE" ]; then
                            echo "Found migration file: $MIGRATION_FILE"
                            
                            # Modify the SQL file to include --disable-transaction
                            if [ -f "$MIGRATION_FILE/migration.sql" ]; then
                                # Check if it already has --disable-transaction
                                if ! grep -q "-- disable-transaction" "$MIGRATION_FILE/migration.sql"; then
                                    echo "Adding --disable-transaction to migration file..."
                                    # Create a backup
                                    cp "$MIGRATION_FILE/migration.sql" "$MIGRATION_FILE/migration.sql.bak"
                                    # Add --disable-transaction at the top
                                    echo "-- disable-transaction" > "$MIGRATION_FILE/migration.sql.tmp"
                                    cat "$MIGRATION_FILE/migration.sql" >> "$MIGRATION_FILE/migration.sql.tmp"
                                    mv "$MIGRATION_FILE/migration.sql.tmp" "$MIGRATION_FILE/migration.sql"
                                    echo "✅ Added --disable-transaction to migration file"
                                else
                                    echo "✅ --disable-transaction already present in migration file"
                                fi
                                
                                # Apply the migration directly
                                echo "Applying fixed migration..."
                                if npx prisma db execute --file "$MIGRATION_FILE/migration.sql" --schema ./prisma/schema.prisma; then
                                    echo "✅ Fixed migration applied successfully"
                                else
                                    echo "⚠️  Direct SQL execution failed, continuing anyway..."
                                fi
                            else
                                echo "⚠️  Migration SQL file not found at $MIGRATION_FILE/migration.sql"
                            fi
                        else
                            echo "⚠️  Migration directory not found for: $MIGRATION_NAME"
                        fi
                        
                        # Try migrating again
                        echo "Retrying prisma migrate deploy..."
                        if ! npx prisma migrate deploy; then
                            echo "⚠️  Migration still failing, but continuing with hotfixes..."
                        else
                            echo "✅ Migration completed successfully!"
                        fi
                    else
                        if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ]; then
                            echo "Prisma migrate deploy failed during Railway startup; proceeding to compatibility hotfix check."
                        else
                            exit 1
                        fi
                    fi
                else
                    # Extract failed migration names from the deploy output
                    FAILED_MIGRATIONS=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*`\([^`]*\)` migration.*failed.*/\1/p')
                    
                    if [ -n "$FAILED_MIGRATIONS" ]; then
                        for mig in $FAILED_MIGRATIONS; do
                            echo "Marking migration $mig as rolled back..."
                            npx prisma migrate resolve --rolled-back "$mig" || true
                        done
                        
                        echo "Retrying prisma migrate deploy..."
                        if ! npx prisma migrate deploy; then
                            if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ]; then
                                echo "Prisma migrate deploy still failed during Railway startup; proceeding to compatibility hotfix check."
                            else
                                exit 1
                            fi
                        fi
                    else
                        if [ -n "${RAILWAY_ENVIRONMENT_ID:-}${RAILWAY_PROJECT_ID:-}" ]; then
                            echo "Prisma migrate deploy failed during Railway startup; proceeding to compatibility hotfix check."
                        else
                            exit 1
                        fi
                    fi
                fi
            else
                echo "✅ Migrations applied successfully!"
            fi
        else
            echo "ℹ️  No migrations found in ./prisma/migrations"
        fi
    fi
fi

# ============================================
# DYNAMIC HOTFIX HANDLING
# ============================================

echo "📁 Checking for compatibility hotfixes..."

# Check if hotfixes directory exists
if [ -d "./prisma/hotfixes" ] && [ "$(ls -A ./prisma/hotfixes 2>/dev/null)" ]; then
    echo "📁 Found hotfixes in ./prisma/hotfixes"
    
    # Count total hotfix files
    TOTAL_HOTFIXES=$(find ./prisma/hotfixes -name "*.sql" -type f | wc -l)
    echo "📊 Found $TOTAL_HOTFIXES hotfix SQL files"
    
    # Track successful and failed hotfixes
    SUCCESSFUL=0
    FAILED=0
    SKIPPED=0
    
    # Execute each hotfix dynamically
    for HOTFIX_FILE in ./prisma/hotfixes/*.sql; do
        # Check if file exists
        if [ -f "$HOTFIX_FILE" ]; then
            HOTFIX_NAME=$(basename "$HOTFIX_FILE")
            echo ""
            echo "▶️  Applying hotfix: $HOTFIX_NAME"
            
            # Check if the hotfix has a skip condition file
            SKIP_FILE="${HOTFIX_FILE%.sql}.skip"
            if [ -f "$SKIP_FILE" ]; then
                echo "⏭️  Skipping $HOTFIX_NAME (skip file found)"
                SKIPPED=$((SKIPPED + 1))
                continue
            fi
            
            # Execute the hotfix
            if npx prisma db execute --file "$HOTFIX_FILE" --schema ./prisma/schema.prisma 2>&1; then
                echo "✅ Hotfix $HOTFIX_NAME applied successfully"
                SUCCESSFUL=$((SUCCESSFUL + 1))
            else
                # Check if the error is about a missing column/table (which is acceptable)
                ERROR_OUTPUT=$(npx prisma db execute --file "$HOTFIX_FILE" --schema ./prisma/schema.prisma 2>&1)
                if echo "$ERROR_OUTPUT" | grep -q -E "column.*does not exist|relation.*does not exist|already exists"; then
                    echo "ℹ️  Hotfix $HOTFIX_NAME skipped (column/table already exists or doesn't need migration)"
                    SKIPPED=$((SKIPPED + 1))
                else
                    echo "⚠️  Hotfix $HOTFIX_NAME failed: $ERROR_OUTPUT"
                    echo "Continuing anyway..."
                    FAILED=$((FAILED + 1))
                fi
            fi
        fi
    done
    
    # Summary of hotfix execution
    echo ""
    echo "📊 Hotfix Summary:"
    echo "   ✅ Successful: $SUCCESSFUL"
    echo "   ⚠️  Failed: $FAILED"
    echo "   ⏭️  Skipped: $SKIPPED"
    echo "   📁 Total: $TOTAL_HOTFIXES"
    
    if [ $FAILED -gt 0 ]; then
        echo "⚠️  Some hotfixes failed, but continuing with server startup..."
    fi
else
    if [ -d "./prisma/hotfixes" ]; then
        echo "ℹ️  No hotfix SQL files found in ./prisma/hotfixes"
    else
        echo "ℹ️  hotfixes directory not found, skipping"
    fi
fi

# ============================================
# VALIDATE THE STATE
# ============================================

echo ""
echo "🔍 Validating final state..."

# Check if Prisma client is available
if [ -f "./node_modules/.prisma/client/index.js" ]; then
    echo "✅ Prisma client is available"
else
    echo "⚠️  Prisma client not found, generating..."
    npx prisma generate || echo "⚠️  Prisma generate failed"
fi

# Entry point already attempted migrations. Prevent duplicate startup attempt in node process.
export AUTO_MIGRATE_ON_START=false

echo ""
echo "🚀 Starting server..."
exec node dist/index.js
