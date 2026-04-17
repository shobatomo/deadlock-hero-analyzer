import express from "express"
import cors from "cors"

// expressを初期化
const app = express()

// CORSを有効に
app.use(cors())

// APIエンドポイント定義
app.get("/api/health", (req, res) => {
    res.json({ status: "OK" })
})

// サーバー起動
app.listen(3000, () => {
    console.log("Server is running on port 3000")
})