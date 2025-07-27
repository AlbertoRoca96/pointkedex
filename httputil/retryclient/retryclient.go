package retryclient

import (
    	"context
		"errors
    		"net/http
    		"sync
    		"time
)

// ========================= Zen Puppy Notice ============================\n// This package provides a thin, dependency-free HTTP client wrapper that
// automatically handles:
//   1. Rate limiting via token bucket (so we stop smashing the API)
//   2. Exponential back-off retries for 429 (Too Many Requests) & 5xx codes.
// ======================================================================\n// NOTE: This helper is intentionally self-contained and side-effect free so
// you can vendor-drop it anywhere inside your Go codebase.
//-------------------------------------------------------------------------

// Config controls the behaviour of the retry client.
// All durations are expressed in milliseconds for easy JSON/YAML env decoding.
// Zero values enable sane defaults.
//
// Usage: cfg := retryclient.Config{MaxRPS: 10}
//        cli := retryclient.New(cfg)
//        resp, err := cli.Get(url)
//
// Safe for concurrent use.
//-------------------------------------------------------------------------
type Config struct {
    // MaxRPS caps requests per second (token bucket). 0 = unlimited.
    MaxRPS int `json:"max_rps"`

    // MaxRetries is the maximum number of retry attempts. 0 -> default(3).
    MaxRetries int `json:"max_retries"`

    // InitialBackoff is the delay before the first retry. 0 -> 200ms.
    InitialBackoff time.Duration `json:"initial_backoff_ms"`

    // MaxBackoff caps exponential backoff delay. 0 -> 2s.
    MaxBackoff time.Duration `json:"max_backoff_ms"`

    // HTTPClient optionally overrides the underlying *http.Client.
    HTTPClient *http.Client `json:"-"`
}

// New returns a *http.Client that performs transparent rate limiting and retries.
func New(cfg Config) *http.Client {
    if cfg.MaxRetries <= 0 {
        cfg.MaxRetries = 3
    }
    if cfg.InitialBackoff == 0 {
        cfg.InitialBackoff = 200 * time.Millisecond
    }
    if cfg.MaxBackoff == 0 {
        cfg.MaxBackoff = 2 * time.Second
    }

    base := cfg.HTTPClient
    if base == nil {
        base = &http.Client{
            Timeout: 15 * time.Second,
        }
    }

    // Compose transport chain: rate limiter -> retry -> original transport.
    rt := base.Transport
    if rt == nil {
        rt = http.DefaultTransport
    }

    // Wrapping order: first take the token, then execute with retry logic
    rt = &rateLimiterTransport{
        maxRPS: cfg.MaxRPS,
        next:   rt,
    }
    rt = &retryTransport{
        maxRetries:     cfg.MaxRetries,
        initialBackoff: cfg.InitialBackoff,
        maxBackoff:     cfg.MaxBackoff,
        next:           rt,
    }

    cloned := *base
    cloned.Transport = rt
    return &cloned
}

// ---------------------------- Rate Limiter ----------------------------

// rateLimiterTransport implements a simple token bucket using time.Ticker.
// If maxRPS <= 0, rate-limiting is disabled.
//-------------------------------------------------------------------------
type rateLimiterTransport struct {
    maxRPS int
    once   sync.Once
    tokens chan struct{}
    next   http.RoundTripper
}

func (r *rateLimiterTransport) init() {
    if r.maxRPS <= 0 {
        return // disabled
    }
    r.tokens = make(chan struct{}, r.maxRPS)
    ticker := time.NewTicker(time.Second / time.Duration(r.maxRPS))
    go func() {
        for range ticker.C {
            select {
            case r.tokens <- struct{}{}:
            default:
            }
        }
    }()
}

func (r *rateLimiterTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    r.once.Do(r.init)
    if r.maxRPS > 0 {
        select {
        case <-req.Context().Done():
            return nil, req.Context().Err()
        case <-r.tokens:
            // got a token, carry on
        }
    }
    return r.next.RoundTrip(req)
}

// ----------------------------- Retry Logic ----------------------------

var (
    errMaxRetries = errors.New("retryclient: max retry attempts reached")
)

// retryTransport retries on transient HTTP status codes (429, 5xx) as well as
// transport-level errors.
//-------------------------------------------------------------------------
type retryTransport struct {
    maxRetries     int
    initialBackoff time.Duration
    maxBackoff     time.Duration
    next           http.RoundTripper
}

func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    // Clone the request body when retriable – only works if Body implements GetBody
    // or is nil.
    if req.Body != nil && req.GetBody == nil {
        // Non-replayable body ‑ bail early so we don’t corrupt payloads
        return t.next.RoundTrip(req)
    }

    var attempt int
    backoff := t.initialBackoff

    for {
        attempt++
        // Ensure we have a fresh body for each attempt
        if attempt > 1 && req.Body != nil {
            br, err := req.GetBody()
            if err != nil {
                return nil, err
            }
            req.Body = br
        }

        resp, err := t.next.RoundTrip(req)
        if !shouldRetry(resp, err) || attempt > t.maxRetries {
            if attempt > t.maxRetries && shouldRetry(resp, err) {
                if resp != nil {
                    resp.Body.Close()
                }
                return nil, errMaxRetries
            }
            return resp, err
        }

        // Consume any response body to let connection reuse.
        if resp != nil {
            resp.Body.Close()
        }

        // Respect Retry-After header if present.
        if ra := getRetryAfter(resp); ra > 0 {
            t.sleep(req.Context(), ra)
        } else {
            t.sleep(req.Context(), backoff)
            backoff = backoff * 2
            if backoff > t.maxBackoff {
                backoff = t.maxBackoff
            }
        }
    }
}

func (t *retryTransport) sleep(ctx context.Context, d time.Duration) {
    timer := time.NewTimer(d)
    select {
    case <-ctx.Done():
    case <-timer.C:
    }
    timer.Stop()
}

// shouldRetry returns true for transport errors OR HTTP status 429 / 5xx.
func shouldRetry(resp *http.Response, err error) bool {
    if err != nil {
        return true
    }
    if resp == nil {
        return true
    }
    if resp.StatusCode == http.StatusTooManyRequests {
        return true
    }
    if resp.StatusCode >= 500 && resp.StatusCode <= 599 {
        return true
    }
    return false
}

// getRetryAfter parses Retry-After header (seconds only)
func getRetryAfter(resp *http.Response) time.Duration {
    if resp == nil {
        return 0
    }
    if ra := resp.Header.Get("Retry-After"); ra != "" {
        if sec, err := time.ParseDuration(ra + "s"); err == nil {
            return sec
        }
    }
    return 0
}
