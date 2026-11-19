import { DSH_HOME } from 'dsh-tauri'
import { homedir } from 'node:os'
import { join } from 'pathe'

export const SKILL_FILE_NAME = 'SKILL.md'
export const SKILLS_DATA_DIR = join(DSH_HOME, 'skills')
/**
 * DSH 原生的用户技能根（`source: 'user-agents'`）。
 *
 * 「打开技能目录」跳这里而不是 `~/.dsh/skills`：0.2.2 起 DSH 原生扫 `~/.agents/skills`，
 * 用户（和 skill-creator）实际创建的技能就在这儿；`~/.dsh/skills` 只是我们自己的数据目录。
 */
export const AGENTS_SKILLS_DIR = join(homedir(), '.agents', 'skills')

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'
export const PATCH_FILE_NAME = 'cordis.patch.yml'
