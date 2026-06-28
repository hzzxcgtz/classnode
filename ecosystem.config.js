/**
 * ClassNode PM2 进程管理配置
 *
 * <INSTALL_DIR> 是占位符，install.sh 会自动替换为实际安装目录。
 * 你也可以手动修改后直接使用：
 *   pm2 start ecosystem.config.js
 *
 * 常用命令：
 *   pm2 status              — 查看运行状态
 *   pm2 logs classnode      — 查看日志
 *   pm2 restart classnode   — 重启服务
 *   pm2 stop classnode      — 停止服务
 *   pm2 startup             — 设置开机自启（需 sudo）
 */
module.exports = {
  apps: [
    {
      name: 'classnode',
      cwd: '<INSTALL_DIR>',
      script: 'server/dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DATABASE_URL: 'file:./server/prisma/dev.db',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '<INSTALL_DIR>/server/logs/pm2-error.log',
      out_file: '<INSTALL_DIR>/server/logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
