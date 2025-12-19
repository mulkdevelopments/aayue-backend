# EC2 Deployment and Database Management Guide

This guide covers how to deploy the backend to an AWS EC2 instance, manage the PostgreSQL database, and handle SQL migrations.

## 1. Prerequisites

*   **AWS EC2 Instance**: An Ubuntu instance (e.g., Ubuntu 22.04 or 24.04).
*   **SSH Key**: The private key (`.pem` file) used to access the instance.
*   **Security Group**: Ensure ports `22` (SSH), `80` (HTTP), `443` (HTTPS), and `5000` (Backend API) are open in your EC2 Security Group.

## 2. Deploying the Backend

The `deploy-backend.sh` script automates the deployment process. It handles:
1.  Setting key permissions.
2.  Syncing your local code to the server.
3.  Installing Docker (if missing).
4.  Starting services using Docker Compose.
5.  Configuring Caddy as a reverse proxy.

### Usage

Run the script from your local terminal:

```bash
./deploy-backend.sh <EC2_PUBLIC_IP> <PATH_TO_PEM_KEY>
```

**Example:**
```bash
./deploy-backend.sh 16.171.230.120 aayeu-ecom-key.pem
```

## 3. Database Migration & Management

The application uses PostgreSQL running in a Docker container named `ecommerce-backend-main-postgres-1` (or similar, check with `docker ps`).

### A. Initial Database Setup (`ecommerce.sql`)

> [!WARNING]
> The `db/ecommerce.sql` file contains `DROP TABLE IF EXISTS` commands. **Running this on an existing production database will delete all your data.** Only use this for a fresh installation or if you intend to reset the database.

To import the initial schema and data:

1.  **SSH into your EC2 instance:**
    ```bash
    ssh -i "aayeu-ecom-key.pem" ubuntu@16.171.230.120
    ```

2.  **Run the import command:**
    ```bash
    # Assuming the file is uploaded to ~/app/db/ecommerce.sql
    cat ~/app/db/ecommerce.sql | sudo docker compose -f ~/app/docker-compose.backend.yml exec -T postgres psql -U postgres -d ecommerce
    ```
    *(Note: You might need to adjust the database name `-d ecommerce` if it's different in your `.env` file. Default user is usually `postgres`)*.

### B. Incremental Updates (`add_admins.sql`)

To run smaller SQL scripts (like adding admins) without wiping the database:

1.  **SSH into the server.**
2.  **Run the specific SQL file:**
    ```bash
    cat ~/app/db/add_admins.sql | sudo docker compose -f ~/app/docker-compose.backend.yml exec -T postgres psql -U postgres -d ecommerce
    ```

### C. Connecting to the Database

You can connect to the database directly to run queries (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).

**Option 1: Command Line (via SSH)**
```bash
# 1. SSH into the server
ssh -i "key.pem" ubuntu@ip

# 2. Enter the Postgres container
sudo docker compose -f ~/app/docker-compose.backend.yml exec postgres psql -U postgres -d ecommerce
```
Once inside the SQL prompt:
*   **List tables:** `\dt`
*   **Select data:** `SELECT * FROM admins;`
*   **Insert data:** `INSERT INTO admins (email, name) VALUES ('new@email.com', 'Name');`
*   **Update data:** `UPDATE admins SET is_active = true WHERE email = 'new@email.com';`
*   **Delete data:** `DELETE FROM admins WHERE email = 'new@email.com';`
*   **Exit:** `\q`

**Option 2: GUI Tool (DBeaver, pgAdmin)**
To use a GUI tool on your local machine, you need to expose the Postgres port (5432) on the EC2 instance (ensure Security Group allows it, or use SSH Tunneling).

**Recommended: SSH Tunneling (More Secure)**
Most GUI tools support SSH Tunneling.
*   **SSH Host:** `16.171.230.120`
*   **SSH User:** `ubuntu`
*   **SSH Key:** Path to your `.pem` file.
*   **DB Host:** `localhost` (relative to the server)
*   **DB Port:** `5432`
*   **DB User/Pass:** (From your `.env` file)

## 4. Troubleshooting

*   **Check Logs:**
    ```bash
    sudo docker compose -f ~/app/docker-compose.backend.yml logs -f backend
    ```
*   **Restart Services:**
    ```bash
    sudo docker compose -f ~/app/docker-compose.backend.yml restart
    ```
