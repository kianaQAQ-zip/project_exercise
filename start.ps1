# ============================================================
# Enterprise AI Agent - 一键启动脚本 (Windows PowerShell)
# ============================================================
# 用法:
#   .\start.ps1             一键启动所有服务
#   .\start.ps1 -NoFrontend  仅启动后端服务
#   .\start.ps1 -NoCelery    不启动 Celery Worker
#
# 前置依赖:
#   1. PostgreSQL 需已在本地运行 (端口 5432)
#   2. Redis 需已在本地运行 (端口 6379)
#   3. Python .venv 虚拟环境已创建
#   4. 前端依赖已安装 (cd frontend && npm install)
# ============================================================

param(
    [switch]$NoFrontend,
    [switch]$NoCelery
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

# UTF-8
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Enterprise AI Agent - 启动中..." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ----------------------------------------------------------
# 0. 检查前置依赖
# ----------------------------------------------------------
Write-Host "[0/4] 检查前置依赖..." -ForegroundColor Yellow

# 检查 .venv
if (-not (Test-Path "$ProjectRoot\.venv\Scripts\python.exe")) {
    Write-Host "  ERROR: 未找到 .venv 虚拟环境" -ForegroundColor Red
    exit 1
}

# 检查 PostgreSQL
try {
    $null = Get-Process -Name "postgres" -ErrorAction Stop
    Write-Host "  PostgreSQL 运行中" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: 未检测到 PostgreSQL 进程，请确保 PostgreSQL 已启动 (端口 5432)" -ForegroundColor Yellow
}

# 检查 Redis
try {
    $null = Get-Process -Name "redis-server" -ErrorAction Stop
    Write-Host "  Redis 运行中" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: 未检测到 Redis 进程，请确保 Redis 已启动 (端口 6379)" -ForegroundColor Yellow
}

# 检查前端 node_modules
if (-not $NoFrontend) {
    if (-not (Test-Path "$ProjectRoot\frontend\node_modules")) {
        Write-Host "  WARNING: 前端依赖未安装，正在安装..." -ForegroundColor Yellow
        Push-Location "$ProjectRoot\frontend"
        npm install
        Pop-Location
    }
    Write-Host "  前端依赖 就绪" -ForegroundColor Green
}

Write-Host ""

# ----------------------------------------------------------
# 1. 启动 Celery Worker
# ----------------------------------------------------------
if (-not $NoCelery) {
    Write-Host "[1/4] 启动 Celery Worker..." -ForegroundColor Yellow
    $celeryJob = Start-Job -Name "celery-worker" -ScriptBlock {
        param($root)
        Set-Location $root
        $env:PYTHONIOENCODING = "utf-8"
        & "$root\.venv\Scripts\celery.exe" -A backend.tasks.celery_app worker --loglevel=info --concurrency=2 -Q celery 2>&1
    } -ArgumentList $ProjectRoot
    Write-Host "  Celery Worker 已在后台启动 (Job ID: $($celeryJob.Id))" -ForegroundColor Green
    Start-Sleep -Seconds 2
    Write-Host ""
} else {
    Write-Host "[1/4] 跳过 Celery Worker (--NoCelery)" -ForegroundColor DarkGray
    Write-Host ""
}

# ----------------------------------------------------------
# 2. 启动 FastAPI 后端
# ----------------------------------------------------------
Write-Host "[2/4] 启动 FastAPI 后端 (端口 8000)..." -ForegroundColor Yellow
$backendJob = Start-Job -Name "fastapi-backend" -ScriptBlock {
    param($root)
    Set-Location $root
    $env:PYTHONIOENCODING = "utf-8"
    & "$root\.venv\Scripts\uvicorn.exe" backend.main:app --host 0.0.0.0 --port 8000 --reload --log-level info 2>&1
} -ArgumentList $ProjectRoot
Write-Host "  FastAPI 后端已在后台启动 (Job ID: $($backendJob.Id))" -ForegroundColor Green
Write-Host "  API 地址: http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API 文档: http://localhost:8000/docs" -ForegroundColor Cyan
Start-Sleep -Seconds 3
Write-Host ""

# ----------------------------------------------------------
# 3. 启动 Vite 前端
# ----------------------------------------------------------
if (-not $NoFrontend) {
    Write-Host "[3/4] 启动 Vite 前端 (端口 5173)..." -ForegroundColor Yellow
    $frontendJob = Start-Job -Name "vite-frontend" -ScriptBlock {
        param($root)
        Set-Location "$root\frontend"
        npm run dev 2>&1
    } -ArgumentList $ProjectRoot
    Write-Host "  前端已在后台启动 (Job ID: $($frontendJob.Id))" -ForegroundColor Green
    Write-Host "  前端地址: http://localhost:5173" -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    Write-Host ""
} else {
    Write-Host "[3/4] 跳过前端 (--NoFrontend)" -ForegroundColor DarkGray
    Write-Host ""
}

# ----------------------------------------------------------
# 4. 状态汇总
# ----------------------------------------------------------
Write-Host "[4/4] 启动完成!" -ForegroundColor Green
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  服务状态" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  前端:     http://localhost:5173" -ForegroundColor White
Write-Host "  后端 API: http://localhost:8000" -ForegroundColor White
Write-Host "  API 文档: http://localhost:8000/docs" -ForegroundColor White
Write-Host ""

$jobs = Get-Job
if ($jobs.Count -gt 0) {
    Write-Host "  后台任务 (使用 Get-Job 查看，Receive-Job <id> 查看日志):" -ForegroundColor DarkGray
    $jobs | ForEach-Object { Write-Host "    [$($_.Id)] $($_.Name)" -ForegroundColor DarkGray }
}
Write-Host ""
Write-Host "  按 Ctrl+C 停止本脚本（后台任务需手动清理）" -ForegroundColor Yellow
Write-Host "  清理命令: Get-Job | Stop-Job ; Get-Job | Remove-Job" -ForegroundColor Yellow
Write-Host ""

# 保持脚本运行，等待用户 Ctrl+C
# 使用 trap 处理 Ctrl+C 清理
trap {
    Write-Host ""
    Write-Host "正在清理后台服务..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Write-Host "所有服务已停止。" -ForegroundColor Green
    break
}

while ($true) {
    Start-Sleep -Seconds 5
}