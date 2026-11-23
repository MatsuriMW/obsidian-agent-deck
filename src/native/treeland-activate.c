/*
 * treeland-activate —— 用 treeland 原生窗口协议激活一个窗口（TeleAgent Linux 派发用）
 *
 * 背景：treeland 忽略 X11 的 _NET_ACTIVE_WINDOW / windowactivate；Obsidian 前台时
 * 纯 xdotool 无法把 TeleAgent 抬到前台。这个最小 helper 绑定
 * treeland_foreign_toplevel_manager_v1，按标题子串找到窗口并 activate。
 *
 * 用法：treeland-activate "TeleAgent 星辰"     # 成功 exit 0；找不到 exit 2；协议不可用 exit 1
 * 构建：node scripts/build-native.mjs（产物 bin/treeland-activate，不入库）
 *
 * 原 wpe-tl 注释：
 *
 * 为什么需要它：
 *   Treeland 虽然也暴露 `zwlr_foreign_toplevel_manager_v1`（wlr 版），但实测**忽略其写请求**
 *   （`set_minimized` / `unset_minimized` / `activate` 都不生效），只保证状态可读。
 *   DDE 自己的 treeland 协议才是真正可写的通道——本工具用来验证这一点。
 *
 * 用法：
 *   wpe-tl            列出窗口（只读）
 *   wpe-tl -r         还原：对所有窗口 unset_minimized + activate
 *   wpe-tl -r -q      安静模式
 *
 * 编译：见 tools/build-tools.sh
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <poll.h>
#include <wayland-client.h>

#include "treeland-foreign-toplevel-manager-v1-client-protocol.h"

#define MAX_TL 64
enum { ST_MAXIMIZED = 0, ST_MINIMIZED = 1, ST_ACTIVATED = 2, ST_FULLSCREEN = 3 };

struct tl {
    struct treeland_foreign_toplevel_handle_v1 *h;
    char title[256], app_id[128];
    int minimized, activated, closed;
};

static struct wl_display *disp;
static struct treeland_foreign_toplevel_manager_v1 *mgr;
static struct wl_seat *seat;
static struct tl tls[MAX_TL];
static int ntl;
static int quiet;

static void h_title(void *d, struct treeland_foreign_toplevel_handle_v1 *h, const char *t)
{ (void)h; if (t) snprintf(((struct tl *)d)->title, 256, "%s", t); }
static void h_app_id(void *d, struct treeland_foreign_toplevel_handle_v1 *h, const char *a)
{ (void)h; if (a) snprintf(((struct tl *)d)->app_id, 128, "%s", a); }
static void h_pid(void *d, struct treeland_foreign_toplevel_handle_v1 *h, uint32_t p)
{ (void)d; (void)h; (void)p; }
static void h_identifier(void *d, struct treeland_foreign_toplevel_handle_v1 *h, uint32_t i)
{ (void)d; (void)h; (void)i; }
static void h_output_enter(void *d, struct treeland_foreign_toplevel_handle_v1 *h, struct wl_output *o)
{ (void)d; (void)h; (void)o; }
static void h_output_leave(void *d, struct treeland_foreign_toplevel_handle_v1 *h, struct wl_output *o)
{ (void)d; (void)h; (void)o; }
static void h_state(void *d, struct treeland_foreign_toplevel_handle_v1 *h, struct wl_array *st)
{
    (void)h;
    struct tl *t = d;
    t->minimized = t->activated = 0;
    uint32_t *p;
    for (p = st->data; (char *)p < (char *)st->data + st->size; p++) {
        if (*p == ST_MINIMIZED) t->minimized = 1;
        else if (*p == ST_ACTIVATED) t->activated = 1;
    }
}
static void h_done(void *d, struct treeland_foreign_toplevel_handle_v1 *h) { (void)d; (void)h; }
static void h_closed(void *d, struct treeland_foreign_toplevel_handle_v1 *h)
{ (void)h; ((struct tl *)d)->closed = 1; }
static void h_parent(void *d, struct treeland_foreign_toplevel_handle_v1 *h,
                     struct treeland_foreign_toplevel_handle_v1 *p)
{ (void)d; (void)h; (void)p; }

static const struct treeland_foreign_toplevel_handle_v1_listener hl = {
    .pid = h_pid, .title = h_title, .app_id = h_app_id, .identifier = h_identifier,
    .output_enter = h_output_enter, .output_leave = h_output_leave,
    .state = h_state, .done = h_done, .closed = h_closed, .parent = h_parent,
};

static void m_toplevel(void *d, struct treeland_foreign_toplevel_manager_v1 *m,
                       struct treeland_foreign_toplevel_handle_v1 *h)
{
    (void)d; (void)m;
    if (ntl >= MAX_TL) return;
    struct tl *t = &tls[ntl++];
    memset(t, 0, sizeof *t);
    t->h = h;
    treeland_foreign_toplevel_handle_v1_add_listener(h, &hl, t);
}
static void m_finished(void *d, struct treeland_foreign_toplevel_manager_v1 *m) { (void)d; (void)m; }
static const struct treeland_foreign_toplevel_manager_v1_listener ml = {
    .toplevel = m_toplevel, .finished = m_finished,
};

static void on_global(void *d, struct wl_registry *r, uint32_t name, const char *iface, uint32_t ver)
{
    (void)d;
    if (!strcmp(iface, treeland_foreign_toplevel_manager_v1_interface.name)) {
        mgr = wl_registry_bind(r, name, &treeland_foreign_toplevel_manager_v1_interface, ver < 2 ? ver : 2);
        treeland_foreign_toplevel_manager_v1_add_listener(mgr, &ml, NULL);
    } else if (!strcmp(iface, wl_seat_interface.name) && !seat) {
        seat = wl_registry_bind(r, name, &wl_seat_interface, ver < 5 ? ver : 5);
    }
}
static void on_global_remove(void *d, struct wl_registry *r, uint32_t n) { (void)d; (void)r; (void)n; }
static const struct wl_registry_listener rl = { .global = on_global, .global_remove = on_global_remove };

static void pump(int ms)
{
    int waited = 0;
    while (waited < ms) {
        wl_display_dispatch_pending(disp);
        if (wl_display_flush(disp) == -1) break;
        struct pollfd p = { .fd = wl_display_get_fd(disp), .events = POLLIN };
        int step = (ms - waited) > 200 ? 200 : (ms - waited);
        int r = poll(&p, 1, step);
        if (r < 0) break;
        if (r > 0 && wl_display_dispatch(disp) < 0) break;
        waited += step;
    }
    wl_display_dispatch_pending(disp);
}

static void dump(const char *tag)
{
    if (quiet) return;
    printf("  [%s]\n", tag);
    for (int i = 0; i < ntl; i++) {
        if (tls[i].closed) continue;
        printf("    %-18s min=%-3s act=%-3s  %s\n", tls[i].app_id[0] ? tls[i].app_id : "(?)",
               tls[i].minimized ? "yes" : "no", tls[i].activated ? "yes" : "no", tls[i].title);
    }
    fflush(stdout);
}



int main(int argc, char **argv)
{
    const char *needle = argc > 1 ? argv[1] : NULL;
    if (!needle || !*needle) {
        fprintf(stderr, "usage: treeland-activate <window-title-substring>\n");
        return 2;
    }
    disp = wl_display_connect(NULL);
    if (!disp) { fprintf(stderr, "无法连接 Wayland\n"); return 1; }
    struct wl_registry *reg = wl_display_get_registry(disp);
    wl_registry_add_listener(reg, &rl, NULL);
    wl_display_roundtrip(disp);
    wl_display_roundtrip(disp);
    if (!mgr) { fprintf(stderr, "合成器未提供 treeland_foreign_toplevel_manager_v1\n"); return 1; }
    pump(300);
    struct tl *target = NULL;
    for (int i = 0; i < ntl; i++)
        if (!tls[i].closed && strstr(tls[i].title, needle)) { target = &tls[i]; break; }
    if (!target) { fprintf(stderr, "未找到匹配窗口: %s\n", needle); return 2; }
    if (!seat) { fprintf(stderr, "没有 wl_seat，无法 activate\n"); return 1; }
    treeland_foreign_toplevel_handle_v1_unset_minimized(target->h);
    wl_display_flush(disp);
    pump(200);
    treeland_foreign_toplevel_handle_v1_activate(target->h, seat);
    wl_display_flush(disp);
    pump(600);
    printf("activated: %s (%s)\n", target->title, target->app_id);
    fflush(stdout);
    treeland_foreign_toplevel_manager_v1_stop(mgr);
    wl_display_flush(disp);
    wl_display_disconnect(disp);
    return 0;
}
