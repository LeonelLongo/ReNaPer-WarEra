const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() { return new Date().toISOString(); }

function formatLine(level, tag, message) {
    return `[${timestamp()}] [${level}] [${tag}] ${message}`;
}

function writeToFile(line) {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `${date}.log`);
    fs.appendFileSync(file, line + '\n');
}

let _discordChannel = null;
const _queue = [];
let _flushTimer = null;

const LEVEL_PREFIX = { INFO: 'i', WARN: '!', ERROR: 'X' };

function scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(flush, 2000);
}

async function flush() {
    _flushTimer = null;
    if (!_discordChannel || !_queue.length) return;
    while (_queue.length) {
        let block = '';
        while (_queue.length && block.length + _queue[0].length + 1 <= 1900) {
            block += _queue.shift() + '\n';
        }
        if (block.trim()) {
            await _discordChannel.send({ content: `\`\`\`\n${block.trim()}\n\`\`\`` }).catch(() => {});
        }
    }
}

function forwardToDiscord(level, line) {
    if (!_discordChannel) return;
    const prefix = LEVEL_PREFIX[level] ?? '';
    _queue.push(`${prefix} ${line}`);
    scheduleFlush();
}

function setChannel(channel) { _discordChannel = channel; }

const logger = {
    setChannel,
    info(tag, message) {
        const line = formatLine('INFO', tag, message);
        console.log(line);
        writeToFile(line);
        forwardToDiscord('INFO', line);
    },
    warn(tag, message) {
        const line = formatLine('WARN', tag, message);
        console.warn(line);
        writeToFile(line);
        forwardToDiscord('WARN', line);
    },
    error(tag, message) {
        const line = formatLine('ERROR', tag, message);
        console.error(line);
        writeToFile(line);
        forwardToDiscord('ERROR', line);
    }
};

module.exports = logger;
