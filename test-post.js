require('dotenv').config();
const jwt = require('jsonwebtoken');

async function testPost() {
    const token = jwt.sign({ id: "123", email: "test@test.com", role: "OWNER" }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const payload = {
        name: "Debug Shirt",
        description: "Test",
        category: "Tops",
        price: 50,
        wholesalePrice: 50,
        stockQuantity: 100,
        imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
        sizes: ["M", "L"],
        ratings: 0,
        badge: "",
        badgeColor: "",
        active: true
    };

    try {
        const res = await fetch("http://localhost:8080/api/admin/products", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        console.log("STATUS:", res.status);
        console.log("RESPONSE:", text);
    } catch(err) {
        console.error("FETCH FAILED:", err);
    }
}
testPost();
