# Local Development Services Setup

This guide explains how to connect your local development environment to either production services (PostgreSQL, Redis, Elasticsearch) or local Docker services.

## Architecture

We support two development modes:

1. **Production Mode** (`.env.local`) - Connect to production services via SSH tunnel
   - PostgreSQL: localhost:5433
   - Redis: localhost:6380
   - Elasticsearch: localhost:9201

2. **Docker Mode** (`.env.docker`) - Connect to local Docker services
   - PostgreSQL: postgres:5432
   - Redis: redis:6379
   - Elasticsearch: elasticsearch:9200

## Quick Start

### Option 1: Connect to Production Services (Recommended)

```bash
# Terminal 1: Start SSH tunnel
npm run db:tunnel

# Terminal 2: Run app with production DB
npm run dev:local
```

### Option 2: Connect to Local Docker Services

```bash
npm run dev:docker
```

---

## Detailed Setup Instructions

### Production Services Access

#### Prerequisites

- SSH key file must be at: `C:\Users\YourUsername\Downloads\aayeu-ecom-key.pem`
- SSH access to EC2 instance

#### Step-by-Step

1. **Start the SSH Tunnel**

   Open a terminal and run:
   ```bash
   npm run db:tunnel
   ```

   You should see:
   ```
   🔧 Starting SSH tunnels to production services...
      PostgreSQL:     localhost:5433 → ec2-16-171-230-120.eu-north-1.compute.amazonaws.com:5432
      Redis:          localhost:6380 → ec2-16-171-230-120.eu-north-1.compute.amazonaws.com:6379
      Elasticsearch:  localhost:9201 → ec2-16-171-230-120.eu-north-1.compute.amazonaws.com:9200

   ✅ Tunnels established!
      PostgreSQL:     localhost:5433
      Redis:          localhost:6380
      Elasticsearch:  localhost:9201

      Press Ctrl+C to stop the tunnels
   ```

2. **Start Your Application**

   In a **new terminal**, run:
   ```bash
   npm run dev:local
   ```

   This will:
   - Copy `.env.local` to `.env`
   - Start the application connected to production services:
     - PostgreSQL via `localhost:5433`
     - Redis via `localhost:6380`
     - Elasticsearch via `localhost:9201`

3. **Verify Connection**

   Your application should now be connected to all production services.

#### SSH Tunnel Management

```bash
# Start tunnel in foreground (blocks terminal, easy to stop)
npm run db:tunnel

# Start tunnel in background
npm run db:tunnel:start

# Stop background tunnel
npm run db:tunnel:stop

# Check tunnel status
npm run db:tunnel:status
```

#### Connection Details (Production via Tunnel)

- **Host**: localhost
- **Port**: 5433 (local tunnel port)
- **Database**: ecommerce
- **User**: postgres
- **Password**: Login@321

---

### Local Docker Database

#### Prerequisites

- Docker and Docker Compose installed
- PostgreSQL container running: `app-postgres-1`

#### Step-by-Step

1. **Ensure Docker Container is Running**

   ```bash
   docker ps | grep postgres
   ```

   You should see `app-postgres-1` running.

2. **Start Your Application**

   ```bash
   npm run dev:docker
   ```

   This will:
   - Copy `.env.docker` to `.env`
   - Start the application connected to Docker DB via `postgres:5432`

#### Connection Details (Docker)

- **Host**: postgres (Docker network)
- **Port**: 5432
- **Database**: ecommerce
- **User**: postgres
- **Password**: Login@321

---

## Environment Files Overview

### `.env.local` - Production Database via SSH Tunnel

```env
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5433  # SSH tunnel port
```

**Use when**: You want to develop against production data

### `.env.docker` - Local Docker Database

```env
NODE_ENV=development
DB_HOST=postgres
DB_PORT=5432  # Standard PostgreSQL port
```

**Use when**: You want to develop against local/test data

### `.env` - Active Environment

This file is **automatically generated** by the `load-env.js` script. Don't edit it manually.

---

## Troubleshooting

### SSH Tunnel Issues

**Problem**: "SSH key not found"
```
❌ SSH key not found at: C:\Users\...\Downloads\aayeu-ecom-key.pem
```

**Solution**:
- Verify the key file exists at the expected location
- Update `CONFIG.keyPath` in `scripts/db-tunnel.js` if needed

---

**Problem**: "Permission denied (publickey)"

**Solution** (Linux/Mac):
```bash
chmod 400 ~/Downloads/aayeu-ecom-key.pem
```

**Solution** (Windows):
- Right-click the .pem file → Properties → Security
- Remove all users except yourself
- Give yourself Read permissions only

---

**Problem**: "Address already in use" (port 5433)

**Solution**:
```bash
# Check what's using port 5433
# Windows
netstat -ano | findstr :5433

# Linux/Mac
lsof -i :5433

# Kill the process or use a different port in db-tunnel.js
```

---

**Problem**: Tunnel starts but connection fails

**Solution**:
1. Check if PostgreSQL is running on EC2:
   ```bash
   ssh -i ~/Downloads/aayeu-ecom-key.pem ubuntu@ec2-16-171-230-120.eu-north-1.compute.amazonaws.com
   docker ps | grep postgres
   ```

2. Verify PostgreSQL is listening on localhost:5432 inside EC2

---

### Application Connection Issues

**Problem**: "ECONNREFUSED localhost:5433"

**Solution**:
1. Ensure SSH tunnel is running: `npm run db:tunnel:status`
2. Start tunnel if not running: `npm run db:tunnel`
3. Verify correct `.env` file is loaded

---

**Problem**: "Password authentication failed"

**Solution**:
- Verify DB_PASSWORD in your `.env.local` or `.env.docker` matches the database
- Production password: `Login@321`

---

## Security Best Practices

1. ✅ **Use SSH Tunnel** - Never expose PostgreSQL directly to the internet
2. ✅ **Keep `.env` files local** - They're in `.gitignore`, keep them there
3. ✅ **Protect SSH key** - Set restrictive permissions on `.pem` file
4. ✅ **Use `.env.local` for production access** - Never commit production credentials
5. ⚠️ **Be careful with production data** - You're working with real data, not a copy

---

## Manual SSH Tunnel (Alternative)

If you prefer to manage the tunnel manually:

```bash
ssh -i "C:\Users\YourUsername\Downloads\aayeu-ecom-key.pem" \
    -L 5433:localhost:5432 \
    ubuntu@ec2-16-171-230-120.eu-north-1.compute.amazonaws.com \
    -N
```

Then update your `.env`:
```env
DB_HOST=localhost
DB_PORT=5433
```

---

## Direct Connection (Not Recommended)

If you absolutely need direct connection (without SSH tunnel):

1. **Update EC2 Security Group**
   - Add inbound rule: PostgreSQL (5432) from your IP
   - ⚠️ This exposes your database to the internet

2. **Update PostgreSQL Configuration**
   ```bash
   # On EC2, edit postgresql.conf
   listen_addresses = '*'

   # Edit pg_hba.conf
   host all all 0.0.0.0/0 md5
   ```

3. **Use in `.env`**
   ```env
   DB_HOST=ec2-16-171-230-120.eu-north-1.compute.amazonaws.com
   DB_PORT=5432
   ```

⚠️ **Warning**: This is less secure. Use SSH tunnel instead.

---

## Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [SSH Tunneling Guide](https://www.ssh.com/academy/ssh/tunneling)
- [AWS EC2 Security Groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html)

---

## Support

For issues or questions:
1. Check this documentation
2. Verify SSH tunnel status: `npm run db:tunnel:status`
3. Check application logs for connection errors
