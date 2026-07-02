import axios from 'axios';

async function test() {
    const now = Math.floor(Date.now() / 1000);
    console.log('Now:', now);

    // Try finding current start
    const current5m = Math.floor(now / 300) * 300;

    // Try finding next start
    const next5m = Math.ceil(now / 300) * 300;

    for (const ts of [current5m, next5m]) {
        try {
            const slug = `btc-updown-5m-${ts}`;
            console.log('Trying slug:', slug);
            const res = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
            if (res.data && res.data.length > 0) {
                console.log("MARKETS for", slug, ":\n", JSON.stringify(res.data[0].markets[0], null, 2));
            } else {
                console.log('Event not found for', slug);
            }
        } catch (err) {
            console.error(err.message);
        }
    }
}
test();
