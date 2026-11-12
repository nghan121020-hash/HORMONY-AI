
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      return callback(new Error("Chỉ chấp nhận ảnh."));
    }
    callback(null, true);
  }
});

app.use(cors());
app.use(express.json({ limit: "20kb" }));

app.use(express.static(__dirname));
async function startServer() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Không tìm thấy GEMINI_API_KEY trong .env");
  }

  const { GoogleGenAI } = await import("@google/genai");

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  async function generateAI(contents) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents
        });
        return result.text;
      } catch (error) {
        console.error("Gemini:", error.message);
        if (attempt === 3) throw error;
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 2000)
        );
      }
    }
  }

  // KIỂM TRA SERVER
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", app: "HORMONY AI" });
  });

  // TRỢ LÝ HỌC TẬP
  app.post("/api/ask", upload.single("image"), async (req, res) => {
    try {
      const question = (req.body.question || "").trim();

      if (!question && !req.file) {
        return res.status(400).json({
          error: "Hãy nhập câu hỏi hoặc chọn ảnh đề bài."
        });
      }

      if (question.length > 2000) {
        return res.status(400).json({
          error: "Câu hỏi tối đa 2000 ký tự."
        });
      }

      const parts = [{
        text: `Bạn là HORMONY AI, trợ lý học tập dành cho học sinh.

Hỗ trợ Toán, Văn, Anh, Lý và các môn khác.
Giải thích từng bước bằng tiếng Việt đơn giản.
Toán và Lý cần nêu công thức và cách tính.
Tiếng Anh cần giải thích từ vựng, ngữ pháp.
Ngữ văn cần trình bày rõ ý và bố cục.
Nếu đề bài không rõ, hãy hỏi lại học sinh.

${question ? "Câu hỏi: " + question :
"Hãy đọc ảnh đề bài và hướng dẫn học sinh giải."}`
      }];

      if (req.file) {
        parts.push({
          inlineData: {
            mimeType: req.file.mimetype,
            data: req.file.buffer.toString("base64")
          }
        });
      }

      const answer = await generateAI([
        { role: "user", parts }
      ]);

      res.json({ answer });

    } catch (error) {
      console.error(error.message);
      res.status(500).json({
        error: "Trợ lý học tập đang bận. Hãy thử lại nhé!"
      });
    }
  });

  // GIA SƯ TIẾNG ANH
  app.post("/api/english", async (req, res) => {
    try {
      const question = typeof req.body.question === "string"
        ? req.body.question.trim()
        : "";

      const level = ["A1", "A2", "B1", "B2"].includes(req.body.level)
        ? req.body.level
        : "A2";

      const modes = {
        conversation: "Trò chuyện tiếng Anh tự nhiên, mỗi lượt hỏi một câu tiếp nối.",
        grammar: "Sửa ngữ pháp, chỉ lỗi sai và giải thích bằng tiếng Việt.",
        vocabulary: "Dạy 5 từ vựng, nghĩa tiếng Việt và ví dụ.",
        translation: "Dịch Anh-Việt hoặc Việt-Anh và giải thích cấu trúc.",
        speaking: "Tạo bài luyện nói, câu hỏi và gợi ý trả lời. Không tự nhận đã nghe hoặc chấm phát âm khi chưa có âm thanh."
      };

      const mode = modes[req.body.mode]
        ? req.body.mode
        : "conversation";

      if (!question || question.length > 2000) {
        return res.status(400).json({
          error: "Vui lòng nhập nội dung tối đa 2000 ký tự."
        });
      }

      const answer = await generateAI(`
Bạn là gia sư tiếng Anh thân thiện.
Trình độ học sinh: ${level}.
Nhiệm vụ: ${modes[mode]}.
Dùng từ vựng phù hợp trình độ.
Giải thích đơn giản bằng tiếng Việt.

Nội dung học sinh:
${question}
`);

      res.json({ answer });

    } catch (error) {
      console.error("English:", error.message);
      res.status(500).json({
        error: "Gia sư tiếng Anh đang bận. Hãy thử lại!"
      });
    }
  });

  // XỬ LÝ LỖI TẢI ẢNH
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "Ảnh vượt quá 5 MB."
          : "Không thể tải ảnh."
      });
    }

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    next();
  });

  app.listen(PORT, () => {
    console.log(
      `HORMONY AI server đang chạy tại http://localhost:${PORT}`
    );
  });
}

startServer().catch(error => {
  console.error("Lỗi khởi động:", error.message);
  process.exit(1);
});
