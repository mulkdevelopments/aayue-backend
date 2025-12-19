# 🗄️ Database Connection Guide

Quick reference for connecting to databases in development.

## 🚀 Quick Start

### Connect to Production DB
```bash
# Terminal 1
npm run db:tunnel

# Terminal 2
npm run dev:local
```

### Connect to Local Docker DB
```bash
npm run dev:docker
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev:local` | Run app with production DB (requires tunnel) |
| `npm run dev:docker` | Run app with local Docker DB |
| `npm run db:tunnel` | Start SSH tunnel (foreground) |
| `npm run db:tunnel:start` | Start SSH tunnel (background) |
| `npm run db:tunnel:stop` | Stop background tunnel |
| `npm run db:tunnel:status` | Check tunnel status |

## 🔧 Configuration Files

- **`.env.local`** - Production DB via SSH tunnel (localhost:5433)
- **`.env.docker`** - Local Docker DB (postgres:5432)
- **`.env`** - Auto-generated, don't edit manually

## 📖 Full Documentation

See [DATABASE-SETUP.md](./DATABASE-SETUP.md) for complete setup instructions, troubleshooting, and security guidelines.

## ⚠️ Important Notes

- Always use SSH tunnel for production access (never expose DB directly)
- Production DB contains real data - be careful with modifications
- Keep `.env` files local (they're in `.gitignore`)
- SSH key must be at: `~/Downloads/aayeu-ecom-key.pem`

## 🆘 Troubleshooting

**Tunnel won't start?**
- Check if SSH key exists at expected location
- Verify port 5433 is not already in use
- Ensure you have SSH access to EC2

**Connection refused?**
- Make sure tunnel is running: `npm run db:tunnel:status`
- Verify correct `.env` file is loaded
- Check if PostgreSQL is running on EC2

For detailed troubleshooting, see [DATABASE-SETUP.md](./DATABASE-SETUP.md#troubleshooting).
