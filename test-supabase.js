require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function testUpload() {
    try {
        const base64Str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
        const matches = base64Str.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const bucket = process.env.SUPABASE_BUCKET;
        console.log("Bucket:", bucket);

        const { data, error } = await supabase.storage.from(bucket).upload("test.png", buffer, {
            contentType: mimeType,
            upsert: true
        });

        if (error) {
            console.error("SUPABASE ERROR:", error);
        } else {
            console.log("SUPABASE SUCCESS:", data);
        }
    } catch(e) {
        console.error("CATCH ERROR:", e);
    }
}
testUpload();
