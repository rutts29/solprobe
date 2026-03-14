/// GPU hardware profiles for T4 and L4.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuProfile {
    T4,
    L4,
}

/// Static hardware properties for a GPU model.
#[derive(Debug, Clone)]
pub struct GpuHardwareProfile {
    pub name: &'static str,
    pub profile: GpuProfile,
    pub max_temp_c: f32,
    pub tdp_watts: f32,
    pub fb_total_mb: f32,
    pub has_row_remap: bool,
    pub has_page_retirement: bool,
}

/// T4 (Turing TU104): 16 GiB FB, 70W TDP, page retirement (no row remap).
pub const T4_PROFILE: GpuHardwareProfile = GpuHardwareProfile {
    name: "T4",
    profile: GpuProfile::T4,
    max_temp_c: 97.0,
    tdp_watts: 70.0,
    fb_total_mb: 16384.0,
    has_row_remap: false,
    has_page_retirement: true,
};

/// L4 (Ada Lovelace AD104): 24 GiB FB, 72W TDP, row remapping (no page retirement).
pub const L4_PROFILE: GpuHardwareProfile = GpuHardwareProfile {
    name: "L4",
    profile: GpuProfile::L4,
    max_temp_c: 97.0,
    tdp_watts: 72.0,
    fb_total_mb: 24576.0,
    has_row_remap: true,
    has_page_retirement: false,
};

/// Detect GPU model from a string like "Tesla T4", "NVIDIA L4", "T4", "L4".
pub fn detect_profile(model_str: &str) -> Option<&'static GpuHardwareProfile> {
    let upper = model_str.to_uppercase();
    if upper.contains("T4") {
        Some(&T4_PROFILE)
    } else if upper.contains("L4") {
        Some(&L4_PROFILE)
    } else {
        None
    }
}

/// Compute memory usage percentage from used and free framebuffer in MB.
pub fn memory_used_pct(fb_used_mb: f32, fb_free_mb: f32) -> f32 {
    let total = fb_used_mb + fb_free_mb;
    if total <= 0.0 {
        return 0.0;
    }
    (fb_used_mb / total) * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_t4() {
        assert_eq!(detect_profile("Tesla T4").unwrap().profile, GpuProfile::T4);
        assert_eq!(detect_profile("t4").unwrap().profile, GpuProfile::T4);
    }

    #[test]
    fn test_detect_l4() {
        assert_eq!(detect_profile("NVIDIA L4").unwrap().profile, GpuProfile::L4);
    }

    #[test]
    fn test_detect_unknown() {
        assert!(detect_profile("A100").is_none());
    }

    #[test]
    fn test_memory_pct() {
        let pct = memory_used_pct(8192.0, 8192.0);
        assert!((pct - 50.0).abs() < 0.01);
    }
}
