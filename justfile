# traffic-sim task automation

# List available targets
default:
    @just --list

# Install dependencies
install:
    bun install

# Start dev server
dev:
    bun run dev

# Type-check and build production bundle
build:
    bun run build

# Preview production build locally
preview:
    bun run preview

# Run unit tests (geometry / sim core)
test:
    bun test

# Type-check only
check:
    bun x tsc --noEmit
