# Enklayve

**Secure, Private, Local AI-Powered Document Analysis**

Enklayve is a privacy-first desktop application for analyzing documents using local Large Language Models (LLMs). All processing happens on your device with end-to-end encryption, biometric authentication, and zero-knowledge architecture.

## Features

- **Local LLM Inference**: Run models entirely on your device - no cloud, no data leaks
- **GPU Acceleration**: Automatic hardware detection and optimization for Apple Silicon (Metal) and NVIDIA GPUs (CUDA)
- **Document Processing**: PDF, DOCX, TXT, and Markdown support with vector search
- **RAG (Retrieval-Augmented Generation)**: Context-aware question answering from your documents
- **End-to-End Encryption**: AES-256-GCM encryption with Argon2id key derivation
- **Biometric Authentication**: Touch ID (macOS) and Windows Hello support
- **Conversation Management**: Multi-turn conversations with full history
- **Web Search Integration**: DuckDuckGo search for real-time information
- **15+ Curated Models**: Hardware-aware model recommendations

## GPU Acceleration

Enklayve automatically detects your hardware and optimizes inference performance:

### Apple Silicon (Metal)
- **M1/M2/M3/M4**: Automatically enables Metal acceleration
- **Unified Memory Architecture**: Efficient GPU offloading based on available RAM
  - 8GB RAM: 15 GPU layers
  - 16GB RAM: 25 GPU layers
  - 32GB+ RAM: 35 GPU layers

### NVIDIA GPUs (CUDA)
- **Windows/Linux**: Automatic detection via DXGI
- **GPU Layer Allocation**:
  - 8GB RAM: 15 GPU layers
  - 16GB+ RAM: 25 GPU layers
- **Vendor Detection**: Identifies NVIDIA, AMD, and Intel GPUs

### Building with GPU Support

#### macOS (Metal - Default)
```bash
# Metal is enabled by default on macOS
cargo build --release
npm run tauri build
```

#### Windows (CUDA)
```bash
# Build with CUDA support
cargo build --release --features cuda
npm run tauri build -- --features cuda
```

#### Linux (CUDA)
```bash
# Requires CUDA toolkit installed
cargo build --release --features cuda
npm run tauri build -- --features cuda
```

## Development Setup

### Prerequisites
- Node.js 18+ and npm
- Rust 1.70+
- Platform-specific requirements:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools, CUDA Toolkit (optional)
  - **Linux**: GCC, CUDA Toolkit (optional)

### Installation

```bash
# Clone repository
git clone https://github.com/clay-good/enklayve.git
cd enklayve/enklayve-app

# Install dependencies
npm install

# Run development server
npm run tauri dev
```

### Building for Production

```bash
# Build optimized production bundle
npm run tauri build

# Output locations:
# - macOS: src-tauri/target/release/bundle/dmg/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb/ or appimage/
```

## Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust + Tauri 2.0
- **LLM Engine**: llama.cpp (via llama-cpp-2)
- **Embeddings**: BGE-Small-EN-v1.5 (384-dimensional)
- **Database**: SQLite (rusqlite)
- **Encryption**: AES-256-GCM + Argon2id

### Project Structure
```
enklayve-app/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── App.tsx            # Main application
│   └── main.tsx           # Entry point
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── commands.rs    # Tauri command handlers
│   │   ├── hardware.rs    # GPU detection & optimization
│   │   ├── model_cache.rs # Model caching system
│   │   ├── inference.rs   # LLM inference
│   │   ├── documents.rs   # Document processing
│   │   ├── embeddings.rs  # Vector embeddings
│   │   ├── encryption.rs  # AES-256-GCM encryption
│   │   ├── biometric.rs   # Touch ID / Windows Hello
│   │   └── lib.rs         # Core module
│   └── Cargo.toml         # Rust dependencies
└── README.md              # This file
```

## Hardware Requirements

### Minimum
- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 10GB available
- **Performance**: Can run 1-3B models

### Recommended
- **CPU**: 4+ cores
- **RAM**: 16GB+
- **GPU**: Apple Silicon or NVIDIA GPU (4GB+ VRAM)
- **Storage**: 50GB available
- **Performance**: Can run 7-13B models smoothly

### Optimal
- **CPU**: 8+ cores
- **RAM**: 32GB+
- **GPU**: Apple M2 Pro/Max or NVIDIA RTX 3060+ (8GB+ VRAM)
- **Storage**: 100GB+ available
- **Performance**: Can run 70B+ models

## Security Features

- **Zero-Knowledge Architecture**: All data encrypted at rest
- **Biometric Authentication**: Touch ID (macOS) / Windows Hello
- **AES-256-GCM**: Authenticated encryption for all sensitive data
- **Argon2id**: Memory-hard password hashing
- **Local-Only Processing**: No network calls during inference
- **Secure Key Storage**: Platform keychain integration

## Supported Models

Enklayve includes 15+ pre-configured models with automatic hardware-aware recommendations:

- **Qwen 2.5 3B/7B/14B** - Excellent multilingual performance
- **Llama 3.2 1B/3B** - Fast and efficient
- **Mistral 7B** - Balanced performance
- **Phi 3 Mini/Medium** - Optimized for quality
- **Gemma 2 2B/9B/27B** - Google's models
- **And more...**
