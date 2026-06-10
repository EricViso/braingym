// Local development entry point. On Vercel the app runs as a serverless
// function instead (see api/index.js).
require("dotenv").config();

const app = require("./app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Seni Scape survey running at http://localhost:${PORT}`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin.html`);
});
