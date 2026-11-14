"""
RasoiLink Production Gunicorn Configuration
Pairs Gunicorn process manager with high-throughput Uvicorn ASGI workers.
Usage:
    gunicorn -c gunicorn_conf.py main:app
"""

import multiprocessing
import os

# Server Socket Binding
host = os.getenv("HOST", "0.0.0.0")
port = os.getenv("PORT", "8000")
bind = f"{host}:{port}"
backlog = 2048

# Worker Processes
# Standard formula: (2 x num_cores) + 1, capped by WEB_CONCURRENCY environment variable
default_workers = max(2, min(multiprocessing.cpu_count() * 2 + 1, 8))
workers = int(os.getenv("WEB_CONCURRENCY", os.getenv("WORKERS", str(default_workers))))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# Process Naming & Lifecycle
proc_name = "rasoilink_gunicorn"
preload_app = False  # Allows SQLite and background engines to initialize cleanly per worker
graceful_timeout = 30

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'
