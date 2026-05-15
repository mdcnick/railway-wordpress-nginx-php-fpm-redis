#!/bin/bash
set -e

# Graceful shutdown handler
cleanup() {
    echo "Shutting down..."
    nginx -s quit 2>/dev/null || true
    kill -TERM "$PHP_FPM_PID" 2>/dev/null || true
    wait "$PHP_FPM_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# 1. Generate PHP config
PHP_INI_DIR="/usr/local/etc/php/conf.d"
cat > "${PHP_INI_DIR}/custom-settings.ini" << EOF
upload_max_filesize = ${PHP_UPLOAD_MAX_FILESIZE:-256M}
post_max_size = ${PHP_POST_MAX_SIZE:-256M}
memory_limit = ${PHP_MEMORY_LIMIT:-512M}
EOF

# 2. Generate Nginx config
export NGINX_CLIENT_MAX_BODY_SIZE="${NGINX_CLIENT_MAX_BODY_SIZE:-256M}"
mkdir -p /etc/nginx/conf.d
envsubst '${NGINX_CLIENT_MAX_BODY_SIZE}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# 3. Test nginx configuration
echo "Testing nginx configuration..."
nginx -t

# 4. Initialize WordPress files in volume (call original WP entrypoint)
echo "Initializing WordPress..."
docker-entrypoint.sh php-fpm -t

# ============================================
# RAILWAY CACHE SYSTEM SETUP
# ============================================

echo "Setting up Railway Hybrid Cache System..."

# Create cache directories with proper permissions
mkdir -p /var/cache/nginx
mkdir -p /var/www/html/wp-content/cache/railway-page
mkdir -p /var/www/html/wp-content/cache/railway-config
mkdir -p /var/www/html/wp-content/mu-plugins

# Set ownership for nginx cache (www-data needs write access)
chown -R www-data:www-data /var/cache/nginx
chmod 755 /var/cache/nginx

# Set ownership for WordPress cache directories
chown -R www-data:www-data /var/www/html/wp-content/cache
chmod 755 /var/www/html/wp-content/cache

# Install cache system files if not already present
CACHE_SYSTEM_SRC="/usr/local/share/railway-cache-system"

if [ -d "$CACHE_SYSTEM_SRC" ]; then
    # Copy mu-plugin (cache manager)
    if [ -f "$CACHE_SYSTEM_SRC/railway-cache-manager.php" ]; then
        cp "$CACHE_SYSTEM_SRC/railway-cache-manager.php" /var/www/html/wp-content/mu-plugins/
        echo "Railway Cache Manager mu-plugin installed."
    fi

    # Copy advanced-cache.php (WordPress drop-in)
    if [ -f "$CACHE_SYSTEM_SRC/advanced-cache.php" ]; then
        cp "$CACHE_SYSTEM_SRC/advanced-cache.php" /var/www/html/wp-content/advanced-cache.php
        echo "WordPress advanced-cache.php drop-in installed."
    fi
fi

# Ensure advanced-cache.php exists (create minimal fallback if missing)
if [ ! -f "/var/www/html/wp-content/advanced-cache.php" ]; then
    echo "Creating fallback advanced-cache.php..."
    cat > /var/www/html/wp-content/advanced-cache.php << 'CACHEEOF'
<?php
// Railway Cache - Fallback (will be replaced on next restart)
if (defined('WP_CACHE') && WP_CACHE && !is_admin()) {
    define('RAILWAY_CACHE_DIR', WP_CONTENT_DIR . '/cache/railway-page/');

    $cache_key = sha1(($_SERVER['HTTPS'] ?? 'off') !== 'off' ? 'https' : 'http' . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ($_SERVER['REQUEST_URI'] ?? '/'));
    $cache_file = RAILWAY_CACHE_DIR . substr($cache_key, 0, 2) . '/' . $cache_key . '.cache';

    if (file_exists($cache_file) && (time() - filemtime($cache_file)) < 3600) {
        $data = @unserialize(file_get_contents($cache_file));
        if ($data && !empty($data['body'])) {
            header('X-Cache-Status: HIT');
            header('Content-Type: text/html; charset=UTF-8');
            echo $data['body'];
            exit;
        }
    }
}
CACHEEOF
fi

# 5. Inject custom wp-config.php modifications
echo "Configuring wp-config.php..."
if [ -f /var/www/html/wp-config.php ]; then
    # Check if our custom config is already injected
    if ! grep -q "wp-config-custom.php" /var/www/html/wp-config.php; then
        sed -i "2i\\
// Dynamic domain configuration - injected by Railway\\
require_once('/usr/local/share/wp-config-custom.php');\\
" /var/www/html/wp-config.php
        echo "Dynamic domain configuration injected."
    fi

    # Ensure WP_CACHE is defined
    if ! grep -q "define.*WP_CACHE" /var/www/html/wp-config.php; then
        # Add WP_CACHE after the opening PHP tag
        sed -i "2i\\
define('WP_CACHE', true);\\
" /var/www/html/wp-config.php
        echo "WP_CACHE enabled in wp-config.php."
    elif grep -q "define.*WP_CACHE.*false" /var/www/html/wp-config.php; then
        # Replace false with true
        sed -i "s/define\s*(\s*['\"]WP_CACHE['\"]\s*,\s*false\s*)/define('WP_CACHE', true)/" /var/www/html/wp-config.php
        echo "WP_CACHE set to true in wp-config.php."
    fi
fi

# 6. Fix all permissions
chown -R www-data:www-data /var/www/html

echo "Railway Hybrid Cache System setup complete."

# 7. Start Nginx (background, daemon off for proper signal handling)
echo "Starting Nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# 8. Start PHP-FPM (foreground)
echo "Starting PHP-FPM..."
php-fpm &
PHP_FPM_PID=$!

# Wait for either process to exit
wait -n $NGINX_PID $PHP_FPM_PID
