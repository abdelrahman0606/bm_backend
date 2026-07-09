// Content Detection Utility - Automatically detects content type and returns appropriate block type and metadata

const detectBlockType = (content) => {
  if (!content || typeof content !== "string") {
    return {
      type: "note",
      metadata: null,
    };
  }

  const trimmed = content.trim();

  // URL Detection
  if (isUrl(trimmed)) {
    return {
      type: "link",
      metadata: {
        linkMetadata: extractUrlMetadata(trimmed),
      },
    };
  }

  // JSON Detection
  if (isJson(trimmed)) {
    return {
      type: "json",
      metadata: {
        jsonMetadata: {
          schema: trimmed,
          isValid: true,
        },
      },
    };
  }

  // Code Detection
  if (isCode(trimmed)) {
    return {
      type: "code",
      metadata: {
        codeMetadata: {
          language: detectLanguage(trimmed),
          theme: "dark",
          lineNumbers: true,
        },
      },
    };
  }

  // API Endpoint Detection
  if (isApiEndpoint(trimmed)) {
    return {
      type: "api",
      metadata: {
        apiMetadata: extractApiMetadata(trimmed),
      },
    };
  }

  // Markdown Detection
  if (isMarkdown(trimmed)) {
    return {
      type: "documentation",
      metadata: {
        documentationMetadata: {
          format: "markdown",
          outline: extractMarkdownOutline(trimmed),
          sections: countMarkdownSections(trimmed),
        },
      },
    };
  }

  // Default to note
  return {
    type: "note",
    metadata: null,
  };
};

const isUrl = (content) => {
  try {
    const urlPattern = /^(https?:\/\/|www\.)[^\s]+$/i;
    return urlPattern.test(content);
  } catch {
    return false;
  }
};

const isJson = (content) => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

const isCode = (content) => {
  const codeIndicators = [
    /^(function|const|let|var|class|interface|type|import|export)/m,
    /^(def|class|if|for|while|import|from)/m, // Python
    /^(public|private|protected|void|int|String|class)/m, // Java
    /\{[\s\S]*\}/m, // Braces
    /\[[\s\S]*\]/m, // Brackets
    /;$|;[\s]*$/m, // Semicolon end
  ];

  return codeIndicators.some((pattern) => pattern.test(content));
};

const isApiEndpoint = (content) => {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  const lines = content.split("\n");
  
  return lines.some((line) =>
    methods.some(
      (method) =>
        line.includes(method) &&
        (line.includes("http") || line.includes("/api"))
    )
  );
};

const isMarkdown = (content) => {
  const markdownPatterns = [
    /^#+\s+/m, // Headers
    /^\*\*.*\*\*$/m, // Bold
    /^-\s+/m, // Lists
    /^\[.*\]\(.*\)/m, // Links
    /```[\s\S]*?```/m, // Code blocks
  ];

  return markdownPatterns.some((pattern) => pattern.test(content));
};

const detectLanguage = (code) => {
  const languagePatterns = {
    javascript: /^(const|let|var|function|import|export|async|await)/m,
    python: /^(def|class|import|from|if __name__|async|await)/m,
    java: /^(public|private|class|interface|package|import|static)/m,
    go: /^(package|import|func|type|interface)/m,
    rust: /^(fn|let|const|pub|use|mod)/m,
    cpp: /^(#include|using namespace|int main|void|class)/m,
    csharp: /^(using|namespace|class|public|private|async)/m,
    php: /^(<\?php|\$|function|class)/m,
    sql: /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)/i,
    html: /^(<html>|<head>|<body>|<!DOCTYPE)/i,
    css: /^(body|\.class|#id|\@media)/,
  };

  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(code)) {
      return lang;
    }
  }

  return "javascript"; // Default
};

const extractUrlMetadata = (url) => {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return {
      url: url,
      favicon: `https://www.google.com/s2/favicons?domain=${urlObj.hostname}`,
      previewImage: null,
      description: "",
      domain: urlObj.hostname,
    };
  } catch {
    return {
      url: url,
      favicon: null,
      previewImage: null,
      description: "",
      domain: null,
    };
  }
};

const extractApiMetadata = (content) => {
  const methodMatch = content.match(
    /^\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/m
  );
  const urlMatch = content.match(/(?:https?:\/\/|\/)[^\s]*/);

  const method = methodMatch ? methodMatch[1] : "GET";
  const endpoint = urlMatch ? urlMatch[0] : "";

  return {
    method: method,
    endpoint: endpoint,
    baseUrl: "",
    requestBody: null,
    responseBody: null,
    headers: new Map(),
    parameters: [],
  };
};

const extractMarkdownOutline = (content) => {
  const lines = content.split("\n");
  const outline = [];

  lines.forEach((line) => {
    const match = line.match(/^#+\s+(.+)$/);
    if (match) {
      const level = match[0].match(/^#+/)[0].length;
      outline.push({
        level: level,
        text: match[1],
      });
    }
  });

  return outline;
};

const countMarkdownSections = (content) => {
  const matches = content.match(/^#+\s+/gm);
  return matches ? matches.length : 0;
};

module.exports = {
  detectBlockType,
  isUrl,
  isJson,
  isCode,
  isApiEndpoint,
  isMarkdown,
  detectLanguage,
  extractUrlMetadata,
  extractApiMetadata,
  extractMarkdownOutline,
  countMarkdownSections,
};
