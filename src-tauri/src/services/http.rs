//! Küçük HTTP istemcisi (Spotify, AI kullanımı): WinRT `HttpClient`, ek
//! bağımlılık yok. Önbellek kapalı. Bekleyen bir iş parçacığında çağrılmalı.

use windows::Foundation::Uri;
use windows::Storage::Streams::UnicodeEncoding;
use windows::Web::Http::Filters::{
    HttpBaseProtocolFilter, HttpCacheReadBehavior, HttpCacheWriteBehavior,
};
use windows::Web::Http::{HttpClient, HttpMethod, HttpRequestMessage, HttpStringContent};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::core::HSTRING;

pub struct Response {
    pub status: u16,
    pub body: String,
}

/// İstek gövdesi.
pub enum Body<'a> {
    Form(&'a str),
    Json(&'a str),
}

/// `headers`: ek başlıklar (ör. `Authorization`). Hata: bağlantı kurulamadı.
pub fn request(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<Body>,
) -> windows::core::Result<Response> {
    // SAFETY: bu iş parçacığı için COM başlatma; zaten başlatılmışsa zararsız.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let filter = HttpBaseProtocolFilter::new()?;
    let cache = filter.CacheControl()?;
    cache.SetReadBehavior(HttpCacheReadBehavior::NoCache)?;
    cache.SetWriteBehavior(HttpCacheWriteBehavior::NoCache)?;
    let client = HttpClient::Create(&filter)?;
    let has_body = method != "GET";
    let method = match method {
        "POST" => HttpMethod::Post()?,
        "PUT" => HttpMethod::Put()?,
        "DELETE" => HttpMethod::Delete()?,
        _ => HttpMethod::Get()?,
    };
    let request = HttpRequestMessage::Create(&method, &Uri::CreateUri(&HSTRING::from(url))?)?;
    for (name, value) in headers {
        request
            .Headers()?
            .TryAppendWithoutValidation(&HSTRING::from(*name), &HSTRING::from(*value))?;
    }
    if let Some(body) = body {
        let (text, media_type) = match body {
            Body::Form(t) => (t, "application/x-www-form-urlencoded"),
            Body::Json(t) => (t, "application/json"),
        };
        let content = HttpStringContent::CreateFromStringWithEncodingAndMediaType(
            &HSTRING::from(text),
            UnicodeEncoding::Utf8,
            &HSTRING::from(media_type),
        )?;
        request.SetContent(&content)?;
    } else if has_body {
        // Gövdesiz POST/PUT: Spotify Content-Length ister (yoksa 411).
        request.SetContent(&HttpStringContent::CreateFromString(&HSTRING::new())?)?;
    }
    let response = client.SendRequestAsync(&request)?.join()?;
    let status = response.StatusCode()?.0 as u16;
    let body = response
        .Content()?
        .ReadAsStringAsync()?
        .join()?
        .to_string_lossy();
    Ok(Response { status, body })
}
