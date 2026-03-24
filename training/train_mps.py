"""Small GPT-2 style model training on Apple MPS with SolProbe monitoring.

Trains a tiny transformer on synthetic data so SolProbe can monitor real
training metrics (loss, gradient norm, learning rate, throughput) alongside
real Apple Silicon GPU utilization.

Usage:
    pip install torch  # if not already installed
    python -m training.train_mps [--steps 500] [--inject-spike-at 200]

The --inject-spike-at flag artificially corrupts a batch to trigger a loss
spike, demonstrating SolProbe's z-score anomaly detection on real training.
"""

from __future__ import annotations

import argparse
import time

import torch
import torch.nn as nn

from training.callback import SolProbeCallback


class TinyGPT(nn.Module):
    """Minimal GPT-2 style model (~2M params) for demo purposes."""

    def __init__(self, vocab_size: int = 256, d_model: int = 128, n_heads: int = 4,
                 n_layers: int = 4, max_seq_len: int = 64):
        super().__init__()
        self.tok_emb = nn.Embedding(vocab_size, d_model)
        self.pos_emb = nn.Embedding(max_seq_len, d_model)
        layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 4,
            dropout=0.0, batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.head = nn.Linear(d_model, vocab_size)
        self.max_seq_len = max_seq_len

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T = x.shape
        pos = torch.arange(T, device=x.device).unsqueeze(0)
        h = self.tok_emb(x) + self.pos_emb(pos)
        mask = nn.Transformer.generate_square_subsequent_mask(T, device=x.device)
        h = self.transformer(h, mask=mask, is_causal=True)
        return self.head(h)


def generate_batch(batch_size: int, seq_len: int, vocab_size: int,
                   device: torch.device) -> torch.Tensor:
    """Generate random token sequences for training."""
    return torch.randint(0, vocab_size, (batch_size, seq_len), device=device)


def main():
    parser = argparse.ArgumentParser(description="Train tiny GPT on MPS with SolProbe monitoring")
    parser.add_argument("--steps", type=int, default=500, help="Number of training steps")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--seq-len", type=int, default=64, help="Sequence length")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate")
    parser.add_argument("--node-id", type=str, default="node-0", help="SolProbe node ID")
    parser.add_argument("--inject-spike-at", type=int, default=None,
                        help="Inject a loss spike at this step (for demo)")
    args = parser.parse_args()

    # Select device
    if torch.backends.mps.is_available():
        device = torch.device("mps")
        print(f"Using Apple MPS (Metal Performance Shaders)")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
        print(f"Using CUDA")
    else:
        device = torch.device("cpu")
        print(f"Using CPU (MPS not available)")

    # Model setup
    vocab_size = 256
    model = TinyGPT(vocab_size=vocab_size).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    print(f"Model: TinyGPT ({param_count:,} params) on {device}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.steps)
    loss_fn = nn.CrossEntropyLoss()

    # SolProbe callback — writes training metrics to mmap for the sidecar
    peak_tps = 50_000.0 if device.type == "mps" else 15_000.0
    cb = SolProbeCallback(node_id=args.node_id, peak_tps=peak_tps)
    print(f"SolProbe callback active: writing to /tmp/solprobe_training_{args.node_id}.bin")
    print(f"Training for {args.steps} steps (batch_size={args.batch_size}, seq_len={args.seq_len})")
    if args.inject_spike_at:
        print(f"Will inject loss spike at step {args.inject_spike_at}")
    print("---")

    tokens_per_batch = args.batch_size * args.seq_len

    for step in range(args.steps):
        t0 = time.perf_counter()

        # Generate batch
        x = generate_batch(args.batch_size, args.seq_len, vocab_size, device)
        targets = x[:, 1:]  # shift by 1 for next-token prediction
        inputs = x[:, :-1]

        # Optional: inject loss spike by corrupting gradients
        if args.inject_spike_at and step == args.inject_spike_at:
            print(f"\n[!] Injecting loss spike at step {step}...")
            # Feed garbage that produces extreme loss
            inputs = torch.zeros_like(inputs)
            targets = torch.randint(0, vocab_size, targets.shape, device=device)

        # Forward + backward
        logits = model(inputs)
        loss = loss_fn(logits.reshape(-1, vocab_size), targets.reshape(-1))

        optimizer.zero_grad()
        loss.backward()

        # Optional: inject gradient explosion
        if args.inject_spike_at and step == args.inject_spike_at:
            for p in model.parameters():
                if p.grad is not None:
                    p.grad *= 100.0  # artificially inflate gradients

        optimizer.step()
        scheduler.step()

        batch_time = time.perf_counter() - t0

        # Report to SolProbe
        cb.on_train_batch_end(
            step=step,
            loss=loss.item(),
            model=model,
            optimizer=optimizer,
            batch_time=batch_time,
            tokens_in_batch=tokens_per_batch,
        )

        # Print progress every 50 steps
        if step % 50 == 0 or (args.inject_spike_at and step == args.inject_spike_at):
            tps = tokens_per_batch / max(batch_time, 1e-9)
            grad_norm = sum(p.grad.data.norm(2).item() ** 2 for p in model.parameters() if p.grad is not None) ** 0.5
            print(f"step {step:4d} | loss {loss.item():.4f} | grad_norm {grad_norm:.4f} | "
                  f"lr {scheduler.get_last_lr()[0]:.6f} | {tps:.0f} tok/s | {batch_time*1000:.1f}ms")

    cb.on_train_end()
    print("---")
    print("Training complete. SolProbe callback closed.")


if __name__ == "__main__":
    main()
