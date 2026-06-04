/**
 * 版本号统一入口
 * 所有页面引用此文件，修改版本只需改 package.json 中的 version 字段
 */
import pkg from '../../package.json';
export const APP_VERSION = pkg.version;
