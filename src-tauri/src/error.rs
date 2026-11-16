/// Uygulamanın tek hata tipi. Komutlar dışarıya `Result<T, String>` döner (bölüm 9).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error("birincil monitör bulunamadı")]
    NoMonitor,

    #[error("dock penceresi bulunamadı")]
    NoDockWindow,

    #[error("uygulama bulunamadı: {0}")]
    UnknownApp(String),

    #[error("Win32 hatası: {0}")]
    Win32(String),
}

impl From<windows::core::Error> for AppError {
    fn from(e: windows::core::Error) -> Self {
        AppError::Win32(e.message())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

pub type AppResult<T> = Result<T, AppError>;
