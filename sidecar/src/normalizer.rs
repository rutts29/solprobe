/// GPU hardware profiles for T4 and L4.

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuProfile {
    T4,
    L4,
}

/// Static hardware properties for a GPU model.
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
        let profile = detect_profile("T4").unwrap();
        assert_eq!(profile.profile, GpuProfile::T4);
        assert_eq!(profile.fb_total_mb, 16384.0);
        assert_eq!(profile.tdp_watts, 70.0);
        assert_eq!(profile.name, "T4");
    }

    #[test]
    fn test_detect_t4_full_name() {
        assert_eq!(detect_profile("Tesla T4").unwrap().profile, GpuProfile::T4);
    }

    #[test]
    fn test_detect_t4_case_insensitive() {
        // detect_profile uppercases input, so "t4" should work
        assert_eq!(detect_profile("t4").unwrap().profile, GpuProfile::T4);
    }

    #[test]
    fn test_detect_l4() {
        let profile = detect_profile("L4").unwrap();
        assert_eq!(profile.profile, GpuProfile::L4);
        assert_eq!(profile.fb_total_mb, 24576.0);
        assert_eq!(profile.tdp_watts, 72.0);
        assert_eq!(profile.name, "L4");
    }

    #[test]
    fn test_detect_l4_full_name() {
        assert_eq!(
            detect_profile("NVIDIA L4").unwrap().profile,
            GpuProfile::L4
        );
    }

    #[test]
    fn test_detect_h100_returns_none() {
        assert!(detect_profile("H100").is_none());
    }

    #[test]
    fn test_detect_unknown() {
        assert!(detect_profile("A100").is_none());
        assert!(detect_profile("RTX 4090").is_none());
    }

    #[test]
    fn test_memory_used_pct() {
        let pct = memory_used_pct(10000.0, 6384.0);
        // 10000 / (10000+6384) * 100 = 61.04...
        assert!((pct - 61.04).abs() < 0.1);
    }

    #[test]
    fn test_memory_used_pct_50() {
        let pct = memory_used_pct(8192.0, 8192.0);
        assert!((pct - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_memory_used_pct_zero_total() {
        assert_eq!(memory_used_pct(0.0, 0.0), 0.0);
    }
}
