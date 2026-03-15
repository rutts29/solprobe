use anchor_lang::prelude::*;

declare_id!("HmbTLCmaGtYhSJaoxkmkiQuogZwkN5x1hKXEDoN6BqeN");

#[program]
pub mod solprobe_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
