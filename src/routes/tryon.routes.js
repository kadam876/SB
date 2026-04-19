const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');

// Supported MIME types by RapidAPI try-on-diffusion
const SUPPORTED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/** Convert any image buffer to JPEG if format not supported by RapidAPI */
async function ensureJpeg(buffer, mimeType) {
    if (SUPPORTED_MIMES.includes(mimeType)) {
        return { buffer, mimeType };
    }
    
    try {
        const sharp = require('sharp');
        console.log(`[TryOn] Converting ${mimeType} → image/jpeg`);
        const converted = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
        return { buffer: converted, mimeType: 'image/jpeg' };
    } catch (sharpErr) {
        console.warn(`[TryOn] Skipping conversion, sharp not dynamically installable:`, sharpErr.message);
        return { buffer, mimeType }; 
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Decode a base64 data URI → Buffer */
function decodeBase64DataUri(dataUri) {
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    return Buffer.from(base64Data, 'base64');
}

/** Extract mime type from data URI */
function extractMimeType(dataUri) {
    if (dataUri.startsWith('data:') && dataUri.includes(';')) {
        return dataUri.substring(5, dataUri.indexOf(';'));
    }
    return 'image/jpeg';
}

/** Fetch a public image URL → base64 data URI (server-side, bypasses CORS) */
async function fetchUrlAsDataUri(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 30000
    });
    const bytes = Buffer.from(response.data);
    if (!bytes || bytes.length === 0) throw new Error('Empty response from garment URL');
    let mime = response.headers['content-type'] || 'image/jpeg';
    if (mime.includes(';')) mime = mime.substring(0, mime.indexOf(';')).trim();
    console.log(`[TryOn] Fetched garment: ${bytes.length} bytes, mime: ${mime}`);
    return `data:${mime};base64,${bytes.toString('base64')}`;
}

// ── POST /api/tryon/generate  (RapidAPI Try-On Diffusion) ────────────────────
router.post('/generate', async (req, res) => {
    const rapidApiKey  = process.env.RAPIDAPI_KEY;
    const rapidApiHost = process.env.RAPIDAPI_HOST || 'try-on-diffusion.p.rapidapi.com';

    if (!rapidApiKey || rapidApiKey.trim() === '') {
        return res.status(401).json({ error: 'RapidAPI Key not configured on the server.' });
    }

    try {
        let { personImage, garmentImage, garmentUrl } = req.body;

        // Trim empty strings so they are treated as missing
        if (garmentUrl === '') garmentUrl = undefined;
        if (garmentImage === '') garmentImage = undefined;

        console.log('[TryOn] /generate called:', {
            hasPersonImage: !!personImage,
            personSize: personImage?.length,
            hasGarmentImage: !!garmentImage,
            garmentUrl: garmentUrl || '(none)'
        });

        if (!personImage) {
            return res.status(400).json({ error: 'personImage is required.' });
        }

        // Fetch garment from URL server-side if not provided as base64
        if (!garmentImage && garmentUrl) {
            console.log('[TryOn] Fetching garment from URL:', garmentUrl);
            garmentImage = await fetchUrlAsDataUri(garmentUrl);
        }

        if (!garmentImage) {
            return res.status(400).json({ error: 'garmentImage or garmentUrl is required.' });
        }

        console.log(`[TryOn] person size: ${personImage.length}, garment size: ${garmentImage.length}`);

        // Decode base64 → raw bytes and ensure JPEG/PNG for RapidAPI
        let personResult  = await ensureJpeg(decodeBase64DataUri(personImage),  extractMimeType(personImage));
        let garmentResult = await ensureJpeg(decodeBase64DataUri(garmentImage), extractMimeType(garmentImage));

        const personBytes  = personResult.buffer;
        const garmentBytes = garmentResult.buffer;
        const personMime   = personResult.mimeType;
        const garmentMime  = garmentResult.mimeType;
        const personExt    = personMime.split('/')[1] || 'jpg';
        const garmentExt   = garmentMime.split('/')[1] || 'jpg';

        // Build multipart form — field names: avatar_image, clothing_image
        const form = new FormData();
        form.append('avatar_image',   personBytes,  { filename: `avatar.${personExt}`,   contentType: personMime });
        form.append('clothing_image', garmentBytes, { filename: `clothing.${garmentExt}`, contentType: garmentMime });

        const apiUrl = `https://${rapidApiHost}/try-on-file`;
        console.log('[TryOn] Calling RapidAPI:', apiUrl);

        const response = await axios.post(apiUrl, form, {
            headers: {
                ...form.getHeaders(),
                'X-RapidAPI-Key':  rapidApiKey,
                'X-RapidAPI-Host': rapidApiHost
            },
            responseType: 'arraybuffer',
            timeout: 300000 // 5 min
        });

        const responseBytes = Buffer.from(response.data);
        if (!responseBytes || responseBytes.length === 0) {
            throw new Error('RapidAPI returned an empty response.');
        }

        const respContentType = response.headers['content-type'] || '';
        let resultImageUrl;

        if (respContentType.startsWith('image/') || respContentType === 'application/octet-stream') {
            // Raw image returned directly
            const mime = respContentType.startsWith('image/') ? respContentType : 'image/jpeg';
            resultImageUrl = `data:${mime};base64,${responseBytes.toString('base64')}`;
        } else {
            // JSON response — adaptive parsing (same as Java)
            const jsonStr = responseBytes.toString('utf8');
            const root = JSON.parse(jsonStr);

            if (root.image_url)                          resultImageUrl = root.image_url;
            else if (root.url)                           resultImageUrl = root.url;
            else if (root.output?.length > 0)            resultImageUrl = root.output[0];
            else if (root.output_url)                    resultImageUrl = root.output_url;
            else {
                // Return raw JSON wrapped so frontend can debug
                return res.json({ data: [{ raw_response: root }] });
            }
        }

        console.log('[TryOn] Successfully fetched RapidAPI response.');
        return res.json({ data: [{ url: resultImageUrl }] });

    } catch (err) {
        const status = err.response?.status;
        const body   = err.response?.data;
        console.error('[TryOn] RapidAPI error:', status, err.message);
        if (status) {
            return res.status(status).json({ error: body || err.message });
        }
        return res.status(502).json({ error: err.message || 'Unknown error' });
    }
});

// ── POST /api/tryon/gemini  (Gemini image generation) ───────────────────────
router.post('/gemini', async (req, res) => {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiApiUrl = process.env.GEMINI_API_URL ||
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent';

    if (!geminiApiKey || geminiApiKey.trim() === '') {
        return res.status(401).json({ error: 'Gemini API Key not configured on the server.' });
    }

    try {
        let { personImage, garmentImage, garmentUrl } = req.body;

        if (!personImage) return res.status(400).json({ error: 'personImage is required.' });

        if (!garmentImage && garmentUrl) {
            garmentImage = await fetchUrlAsDataUri(garmentUrl);
        }
        if (!garmentImage) return res.status(400).json({ error: 'garmentImage or garmentUrl is required.' });

        // Extract raw base64 (Gemini expects raw base64, not data URI)
        const personB64   = personImage.includes(',')  ? personImage.split(',')[1]  : personImage;
        const garmentB64  = garmentImage.includes(',') ? garmentImage.split(',')[1] : garmentImage;
        const personMime  = extractMimeType(personImage);
        const garmentMime = extractMimeType(garmentImage);

        // Build Gemini payload — identical structure to Java
        const geminiPayload = {
            contents: [{
                parts: [
                    {
                        text: "Task: Virtual Try-On. I am providing two images. First is a person, second is a piece of clothing. Please generate a realistic image where the person is wearing this clothing. Maintain the person's pose, face, and background exactly. Output the final result as an image."
                    },
                    { inline_data: { mime_type: personMime,  data: personB64  } },
                    { inline_data: { mime_type: garmentMime, data: garmentB64 } }
                ]
            }],
            generationConfig: {
                response_modalities: ['Text', 'Image']
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        const response = await axios.post(
            `${geminiApiUrl}?key=${geminiApiKey}`,
            geminiPayload,
            { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
        );

        // Parse Gemini response — look for inline_data image part
        const candidate    = response.data?.candidates?.[0];
        const outputParts  = candidate?.content?.parts || [];
        const imagePart    = outputParts.find(p => p.inline_data?.mime_type?.startsWith('image'));

        if (!imagePart) {
            const textResponse = outputParts.find(p => p.text)?.text || 'No image returned';
            throw new Error('Gemini did not return an image. AI Response: ' + textResponse);
        }

        // Same wrap format as Java so frontend is compatible
        const resultDataUrl = `data:image/png;base64,${imagePart.inline_data.data}`;
        return res.json({ data: [{ url: resultDataUrl }] });

    } catch (err) {
        console.error('[TryOn] Gemini error:', err.message);
        const msg = (err.message || 'Unknown error').replace(/"/g, "'");
        return res.status(500).json({ error: msg });
    }
});

// ── GET /api/tryon/status ─────────────────────────────────────────────────────
router.get('/status', (req, res) => {
    const hasToken = !!(process.env.RAPIDAPI_KEY?.trim());
    res.json({ hfTokenConfigured: hasToken });
});

module.exports = router;
