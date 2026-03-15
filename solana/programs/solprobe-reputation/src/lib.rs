use anchor_lang::prelude::*;

declare_id!("2YPzTvGkQkR5G8vLPBm2cfDXfMkYkQwgNANjKdW4tSMc");

#[program]
pub mod solprobe_reputation {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
