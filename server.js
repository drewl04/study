const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = 3000;

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'questions.json');
const IMAGE_FOLDER = path.join(ROOT, 'images');

ensureDirectoryExists(IMAGE_FOLDER);
ensureDataFileExists(DATA_PATH);

const storage = multer.diskStorage({
    destination: (_req, _file, callback) => {
        callback(null, IMAGE_FOLDER);
    },
    filename: asyncFilenameGenerator
});

const upload = multer({ storage });

app.use(express.static(ROOT));
app.use('/images', express.static(IMAGE_FOLDER));
app.use(express.json());

app.get('/api/chapters', async (_req, res) => {
    try {
        const raw = await fsp.readFile(DATA_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        res.json(parsed);
    } catch (error) {
        console.error('Failed to read questions.json:', error);
        res.status(500).json({ error: 'Failed to read questions.json' });
    }
});

app.post('/api/chapters', async (req, res) => {
    try {
        const payload = req.body;
        validatePayload(payload);

        const tempPath = `${DATA_PATH}.tmp`;
        await fsp.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fsp.rename(tempPath, DATA_PATH);

        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Failed to save questions.json:', error);
        res.status(400).json({ error: error.message || 'Invalid payload' });
    }
});

app.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
    }

    res.json({ path: `/images/${req.file.filename}` });
});

app.delete('/api/delete-image', async (req, res) => {
    try {
        const imagePath = req.body?.path;
        if (!imagePath) {
            return res.status(400).json({ error: 'Missing path' });
        }

        const fullPath = resolveImagePath(imagePath);
        await deleteFileIfExists(fullPath);
        res.json({ status: 'deleted' });
    } catch (error) {
        console.error('Failed to delete image:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.delete('/api/delete-images', async (req, res) => {
    const paths = req.body?.paths;
    if (!Array.isArray(paths)) {
        return res.status(400).json({ error: 'Missing or invalid paths array' });
    }

    const results = [];

    for (const imagePath of paths) {
        try {
            const fullPath = resolveImagePath(imagePath);
            const deleted = await deleteFileIfExists(fullPath);
            results.push({ path: imagePath, status: deleted ? 'deleted' : 'not found' });
        } catch (error) {
            console.error('Failed to delete image:', imagePath, error);
            results.push({ path: imagePath, status: 'error' });
        }
    }

    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

/* =========================
   HELPERS
   ========================= */
function ensureDirectoryExists(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
}

function ensureDataFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
        const emptyDatabase = {
            meta: {
                version: 2,
                nextChapterId: 1,
                nextQuestionId: 1,
                nextImageId: 1
            },
            chapters: []
        };

        fs.writeFileSync(filePath, JSON.stringify(emptyDatabase, null, 2), 'utf8');
    }
}

function asyncFilenameGenerator(req, file, callback) {
    try {
        const chapterId = String(req.query.chapterId || 'unknown');
        const extension = path.extname(file.originalname) || '.png';
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        callback(null, `chapter-${chapterId}-img-${unique}${extension}`);
    } catch (error) {
        callback(error);
    }
}

function resolveImagePath(imagePath) {
    const normalized = imagePath.replace(/^\/+/, '');
    const fullPath = path.join(ROOT, normalized);
    const relative = path.relative(ROOT, fullPath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid image path');
    }

    return fullPath;
}

async function deleteFileIfExists(filePath) {
    try {
        await fsp.unlink(filePath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Payload must be an object');
    }

    if (!payload.meta || typeof payload.meta !== 'object') {
        throw new Error('Missing meta object');
    }

    if (!Array.isArray(payload.chapters)) {
        throw new Error('Missing chapters array');
    }

    payload.chapters.forEach((chapter) => {
        if (!chapter || typeof chapter !== 'object') {
            throw new Error('Each chapter must be an object');
        }

        if (!Number.isFinite(Number(chapter.id))) {
            throw new Error('Each chapter must have a numeric id');
        }

        if (typeof chapter.name !== 'string') {
            throw new Error('Each chapter must have a name');
        }

        if (!Array.isArray(chapter.questions) || !Array.isArray(chapter.images) || !Array.isArray(chapter.order)) {
            throw new Error('Each chapter must include questions, images and order arrays');
        }
    });
}
