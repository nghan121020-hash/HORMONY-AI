
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MODEL = "gemini-3.5-flash";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return callback(new Error("Chỉ chấp nhận tệp hình ảnh."));
    }
    callback(null, true);
  }
});

app.use(cors());
app.use(express.json({ limit: "20kb" }));

// Mở trang chủ từ index.html.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function isTemporaryError(error) {
  const status = Number(error.status || error.code);
  const message = String(error.message || "");

  return [429, 500, 502, 503, 504].includes(status) ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|temporarily unavailable/i.test(message);
}

function getErrorStatus(error) {
  const status = Number(error.status || error.code);

  if (status === 429) return 429;
  if ([500, 502, 503, 504].includes(status)) return 503;

  if (/UNAVAILABLE|high demand/i.test(String(error.message || ""))) {
    return 503;
  }

  return 500;
}

function getErrorMessage(error) {
  const status = getErrorStatus(error);

  if (status === 503) {
    return "Gemini đang quá tải. HORMONY AI đã thử lại nhưng chưa thành công. Bạn hãy đợi một lát rồi thử lại nhé!";
  }

  if (status === 429) {
    return "Gemini đang giới hạn số lượt yêu cầu. Bạn hãy đợi một lát rồi thử lại nhé!";
  }

  return "HORMONY AI đang gặp lỗi. Bạn hãy thử lại sau nhé!";
}

async function startServer() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Thiếu GEMINI_API_KEY trên Render.");
  }

  const { GoogleGenAI } = await import("@google/genai");

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  // Tự động thử lại khi Gemini gặp lỗi tạm thời.
  async function generateWithRetry(contents) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Đang gửi yêu cầu Gemini, lần ${attempt}/3...`);

        const result = await ai.models.generateContent({
          model: MODEL,
          contents
        });

        console.log("Gemini đã phản hồi thành công.");

        return result.text ||
          "Mình chưa tạo được câu trả lời. Bạn thử hỏi lại nhé!";

      } catch (error) {
        console.error(`Gemini lần ${attempt}/3:`, error.message);

        if (!isTemporaryError(error) || attempt === 3) {
          throw error;
        }

        const waitTime = attempt * 2000;

        console.log(`Sẽ thử lại sau ${waitTime / 1000} giây...`);

        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Kiểm tra server.
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      app: "HORMONY AI"
    });
  });

  // TRỢ LÝ HỌC TẬP.
  app.post("/api/ask", upload.single("image"), async (req, res) => {
    try {
      const question = typeof req.body.question === "string"
        ? req.body.question.trim()
        : "";

      const imageFile = req.file;

      if (!question && !imageFile) {
        return res.status(400).json({
          error: "Bạn hãy nhập câu hỏi hoặc chọn ảnh đề bài nhé!"
        });
      }

      if (question.length > 2000) {
        return res.status(400).json({
          error: "Câu hỏi tối đa 2000 ký tự."
        });
      }

      const parts = [{
        text: `Bạn là HORMONY AI, trợ lý học tập thân thiện dành cho học sinh.

NHIỆM VỤ:
1. Hỗ trợ Toán, Ngữ văn, Tiếng Anh, Vật lý và các môn học khác.
2. Giải thích từng bước bằng ngôn ngữ đơn giản.
3. Với Toán và Vật lý, nêu công thức, thay số và cách tính.
4. Với Tiếng Anh, hỗ trợ dịch, từ vựng và ngữ pháp.
5. Với Ngữ văn, trình bày rõ ý và có bố cục.
6. Nếu ảnh mờ hoặc thiếu dữ kiện, hãy nói rõ.
7. Khuyến khích học sinh hiểu cách làm.

Trả lời bằng tiếng Việt, trình bày rõ ràng.

${question
  ? `CÂU HỎI CỦA HỌC SINH:\n${question}`
  : "Học sinh chỉ gửi ảnh đề bài. Hãy đọc ảnh và hỗ trợ giải bài."
}`
      }];

      if (imageFile) {
        parts.push({
          inlineData: {
            mimeType: imageFile.mimetype,
            data: imageFile.buffer.toString("base64")
          }
        });
      }

      const answer = await generateWithRetry([
        { role: "user", parts }
      ]);

      res.json({ answer });

    } catch (error) {
      console.error("Study API error:", error.message);

      res.status(getErrorStatus(error)).json({
        error: getErrorMessage(error)
      });
    }
  });

  // GIA SƯ TIẾNG ANH.
  app.post("/api/english", async (req, res) => {
    try {
      const question = typeof req.body.question === "string"
        ? req.body.question.trim()
        : "";

      const requestedLevel = req.body.level;

      const level = ["A1", "A2", "B1", "B2"].includes(requestedLevel)
        ? requestedLevel
        : "A2";

      const requestedMode = req.body.mode;

      if (!question) {
        return res.status(400).json({
          error: "Bạn hãy nhập nội dung muốn học nhé!"
        });
      }

      if (question.length > 2000) {
        return res.status(400).json({
          error: "Nội dung tối đa 2000 ký tự."
        });
      }

      const modes = {
        conversation: "Trò chuyện tiếng Anh tự nhiên, mỗi lượt chỉ đặt một câu hỏi.",
        grammar: "Sửa lỗi ngữ pháp, viết câu đúng và giải thích bằng tiếng Việt.",
        vocabulary: "Dạy 5 từ vựng, nghĩa tiếng Việt và ví dụ đơn giản.",
        translation: "Dịch Anh-Việt hoặc Việt-Anh và giải thích cấu trúc câu.",
        speaking: "Tạo bài luyện nói, câu hỏi và gợi ý câu trả lời."
      };

      const mode = modes[requestedMode]
        ? requestedMode
        : "conversation";

      const answer = await generateWithRetry(`
Bạn là gia sư tiếng Anh thân thiện dành cho học sinh.

Trình độ: ${level}.
Chế độ: ${modes[mode]}

Dùng từ vựng phù hợp trình độ.
Giải thích đơn giản bằng tiếng Việt.

NỘI DUNG HỌC SINH GỬI:
${question}
`);

      res.json({ answer });

    } catch (error) {
      console.error("English API error:", error.message);

      res.status(getErrorStatus(error)).json({
        error: getErrorMessage(error)
      });
    }
  });

  // Xử lý lỗi tải ảnh.
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Ảnh quá lớn. Vui lòng chọn ảnh dưới 5 MB."
        : "Không thể tải ảnh lên. Vui lòng thử lại.";

      return res.status(400).json({ error: message });
    }

    if (error) {
      return res.status(400).json({
        error: error.message || "Dữ liệu không hợp lệ."
      });
    }

    next();
  });

  app.listen(PORT, () => {
    console.log(`HORMONY AI đang chạy tại cổng ${PORT}`);
  });
}

startServer().catch(error => {
  console.error("Không thể khởi động HORMONY AI:", error.message);
  process.exit(1);
});
