# Enklayve

**100% Local, Always Free, AI-Powered Document Analysis**

Enklayve is a secure, privacy-first desktop application that lets you chat with your documents using powerful AI models running entirely on your computer. No cloud services, no subscriptions, no data leaks.

[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](https://github.com/user/enklayve-dev)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)

## Why Enklayve?

- **100% Local Processing**: Everything runs on your device. No internet required.
- **Always Free**: No subscriptions, no hidden costs, no premium tiers.
- **Private by Default**: Your documents never leave your computer.
- **Powerful Models**: Run models like Qwen 2.5, Llama 3.2, Mistral locally.
- **GPU Accelerated**: Automatic optimization for Apple Silicon and NVIDIA GPUs.

## Key Features

### Privacy & Security
- End-to-end encryption with AES-256-GCM
- Biometric authentication (Touch ID / Windows Hello)
- Zero-knowledge architecture
- All data stays on your device

### Document Intelligence
- Upload PDFs, DOCX, TXT, Markdown files
- Ask questions about your documents
- Get answers with source citations
- Vector search for relevant context

### Performance
- Hardware-aware model recommendations
- Automatic GPU acceleration (Metal, CUDA)
- Intelligent context window optimization
- Fast embedding generation

### User Experience
- Simple mode for beginners
- Advanced mode for power users
- Conversation history
- Export conversations with sources
- Automatic backup and restore

## System Requirements

### Minimum
- **RAM**: 8GB (can run 3B models)
- **Storage**: 10GB available space
- **OS**: macOS 10.15+, Windows 10+, Ubuntu 20.04+

### Recommended
- **RAM**: 16GB (can run 7B models smoothly)
- **GPU**: Apple Silicon M1+ or NVIDIA GTX 1060+
- **Storage**: 50GB available space

### For 14B+ Models
- **RAM**: 32GB+
- **GPU**: Apple M2 Pro/Max or NVIDIA RTX 3060+
- **Storage**: 100GB available space

## Installation

### macOS (Apple Silicon & Intel)

1. Download the DMG installer from [Releases](https://github.com/user/enklayve-dev/releases)
2. Open the DMG file
3. Drag Enklayve to Applications folder
4. Run the following command to allow unsigned app:
   ```bash
   xattr -r -d com.apple.quarantine /Applications/enklayve.app
   ```
5. Launch Enklayve from Applications

### Windows

1. Download the EXE installer from [Releases](https://github.com/user/enklayve-dev/releases)
2. Run the installer
3. Follow the installation wizard
4. Launch Enklayve from Start Menu

### Linux

1. Download the AppImage from [Releases](https://github.com/user/enklayve-dev/releases)
2. Make it executable:
   ```bash
   chmod +x enklayve-*.AppImage
   ```
3. Run the AppImage:
   ```bash
   ./enklayve-*.AppImage
   ```

## Quick Start

1. **First Launch**: Enklayve will detect your hardware and recommend the best model
2. **Download Model**: Click "Download Recommended Model" (one-time download, 1-20GB depending on model)
3. **Upload Document**: Drag and drop a PDF or document file
4. **Ask Questions**: Start chatting about your document
5. **Get Answers**: Receive intelligent responses with source citations

## Supported Document Formats

- PDF (with OCR support for scanned documents)
- Microsoft Word (.docx)
- Plain Text (.txt)
- Markdown (.md)
- Excel (.xlsx) - Coming soon

## Available Models

Enklayve automatically recommends the best model based on your RAM:

| RAM | Recommended Model | Size | Performance |
|-----|-------------------|------|-------------|
| 8GB | Qwen 2.5 3B | 1.9GB | Fast, efficient |
| 16GB | Qwen 2.5 7B | 4.4GB | Balanced, recommended |
| 32GB | Qwen 2.5 14B | 8.7GB | Very smart |
| 64GB+ | Qwen 2.5 32B | 19GB | Maximum intelligence |

All models support 32K context window and run at 30-60 tokens/sec on modern hardware.

## Building from Source

### Prerequisites
- Node.js 20+
- Rust 1.70+
- Platform-specific tools:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools
  - **Linux**: GCC, libwebkit2gtk-4.1-dev

### Build Steps

```bash
# Clone repository
git clone https://github.com/user/enklayve-dev.git
cd enklayve-dev/enklayve-app

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Build Outputs

- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Windows**: `src-tauri/target/release/bundle/nsis/`
- **Linux**: `src-tauri/target/release/bundle/appimage/`

## Project Structure

```
enklayve-dev/
├── enklayve-app/          # Main Tauri application
│   ├── src/               # React frontend
│   │   ├── components/    # UI components
│   │   ├── App.tsx       # Main app component
│   │   └── main.tsx      # Entry point
│   ├── src-tauri/        # Rust backend
│   │   ├── src/
│   │   │   ├── commands.rs        # Tauri commands
│   │   │   ├── inference.rs       # LLM inference
│   │   │   ├── documents.rs       # Document processing
│   │   │   ├── embeddings.rs      # Vector embeddings
│   │   │   ├── hardware.rs        # GPU detection
│   │   │   ├── encryption.rs      # Encryption
│   │   │   ├── biometric.rs       # Biometric auth
│   │   │   ├── conversations.rs   # Chat history
│   │   │   ├── backup.rs          # Backup/restore
│   │   │   ├── export.rs          # Export functionality
│   │   │   └── model_cache.rs     # Model caching
│   │   └── Cargo.toml    # Rust dependencies
│   └── package.json      # Node dependencies
├── .github/
│   └── workflows/        # CI/CD pipelines
└── README.md            # This file
```

## Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Rust + Tauri 2.0
- **LLM Engine**: llama.cpp (via llama-cpp-2)
- **Embeddings**: BGE-Small-EN-v1.5 (fastembed)
- **Database**: SQLite with encryption
- **Vector Search**: Custom cosine similarity
- **Document Processing**: pdf-extract, docx-rs, ocrs (OCR)

### GPU Acceleration

#### Apple Silicon (Automatic)
- Metal acceleration enabled by default
- Unified memory architecture for efficient GPU offloading
- Optimized layer distribution based on available RAM

#### NVIDIA GPUs (Windows/Linux)
- Automatic CUDA detection
- Dynamic GPU layer allocation
- Build with: `cargo build --release --features cuda`

## Troubleshooting

### macOS: "App can't be opened because the developer cannot be verified"
Run this command to remove quarantine attribute:
```bash
xattr -r -d com.apple.quarantine /Applications/enklayve.app
```

### Model download is slow
Models are large (1-20GB). Download times depend on your internet speed. Downloads can be resumed if interrupted.

### Out of memory during inference
Try a smaller model. Qwen 2.5 3B works well on 8GB RAM systems.

### App crashes on startup
Check system requirements. Ensure you have at least 8GB RAM and 10GB free disk space.

### GPU not detected
- **NVIDIA**: Install latest drivers and CUDA toolkit
- **Apple**: Metal is automatic on M1/M2/M3/M4 chips

## Privacy & Security

Enklayve is built with privacy as the foundation:

- **No telemetry**: We don't collect any usage data
- **No analytics**: No tracking, no crash reports (unless you opt-in)
- **No network calls**: Models run 100% offline
- **Encrypted storage**: All data encrypted with AES-256-GCM
- **Secure credentials**: Platform keychain integration
- **Open source**: Full transparency, audit the code yourself

## Performance Tips

1. **Use Simple Mode**: Advanced mode loads all features, Simple mode is faster
2. **Enable Auto-tuning**: Let Enklayve optimize settings for your hardware
3. **Smaller Context Window**: Reduce context window if experiencing slowdowns
4. **Close Other Apps**: Free up RAM for better performance
5. **Use SSD**: Store models on SSD for faster loading

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/user/enklayve-dev/issues)
- **Discussions**: [GitHub Discussions](https://github.com/user/enklayve-dev/discussions)
- **Documentation**: [docs/](docs/)

## Roadmap

- [ ] Excel spreadsheet support
- [ ] Image analysis
- [ ] Voice input/output
- [ ] Multiple document comparison
- [ ] Export to various formats
- [ ] Plugin system
- [ ] Mobile apps (iOS, Android)

## Acknowledgments

Built with:
- [Tauri](https://tauri.app/) - Desktop app framework
- [llama.cpp](https://github.com/ggerganov/llama.cpp) - LLM inference engine
- [Qwen](https://huggingface.co/Qwen) - State-of-the-art language models
- [fastembed](https://github.com/Anush008/fastembed-rs) - Fast embeddings

---

Made with care for privacy and local-first computing.
