package com.courseschedule.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class CourseWidgetProvider extends AppWidgetProvider {

    public static final String ACTION_UPDATE_WIDGET = "com.courseschedule.app.ACTION_UPDATE_WIDGET";

    public static void sendUpdateBroadcast(Context context) {
        try {
            Intent intent = new Intent(context, CourseWidgetProvider.class);
            intent.setAction(ACTION_UPDATE_WIDGET);
            context.sendBroadcast(intent);
        } catch (Throwable ignored) {}
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        try {
            String action = intent != null ? intent.getAction() : null;
            if (ACTION_UPDATE_WIDGET.equals(action)
                    || Intent.ACTION_TIME_CHANGED.equals(action)
                    || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
                updateAllWidgets(context);
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (appWidgetIds == null || appWidgetIds.length == 0) return;
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAllWidgets(Context context) {
        try {
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            ComponentName componentName = new ComponentName(context, CourseWidgetProvider.class);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);
            if (appWidgetIds != null) {
                for (int id : appWidgetIds) {
                    updateAppWidget(context, appWidgetManager, id);
                }
            }
        } catch (Throwable t) {
            t.printStackTrace();
        }
    }

    public static class CourseEntry {
        public String name;
        public String location;
        public String teacher;
        public String startTime;
        public String endTime;
        public int startSection;
        public int endSection;
        public int dayOfWeek;
        public List<Integer> weeks = new ArrayList<>();
        public int startWeek = 1;
        public int endWeek = 20;
        public String weekType = "all";
        public boolean isCancelled = false;

        public boolean isHappeningInWeek(int week) {
            if (!weeks.isEmpty()) {
                return weeks.contains(week);
            }
            if (week < startWeek || week > endWeek) {
                return false;
            }
            if ("single".equalsIgnoreCase(weekType) || "odd".equalsIgnoreCase(weekType)) {
                return week % 2 != 0;
            }
            if ("double".equalsIgnoreCase(weekType) || "even".equalsIgnoreCase(weekType)) {
                return week % 2 == 0;
            }
            return true;
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        try {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_course_4x2);

            // 1. 读取本地持久化数据
            SharedPreferences prefs = context.getSharedPreferences(AndroidWidgetBridge.PREFS_NAME, Context.MODE_PRIVATE);
            String coursesJson = prefs.getString(AndroidWidgetBridge.KEY_COURSES, "");
            String semesterStart = prefs.getString(AndroidWidgetBridge.KEY_SEMESTER_START, "2026-08-31");

            List<CourseEntry> allCourses = parseCourses(coursesJson);

            // 2. 当前系统日期与时间计算
            Calendar now = Calendar.getInstance();
            int hour = now.get(Calendar.HOUR_OF_DAY);
            int currentDayOfWeek = now.get(Calendar.DAY_OF_WEEK);
            // 转为中国星期 (1=周一 ~ 7=周日)
            int todayDay = (currentDayOfWeek == Calendar.SUNDAY) ? 7 : (currentDayOfWeek - 1);
            int currentWeek = calculateCurrentWeek(semesterStart, now.getTime());

            // 明天周几与周次
            int tomorrowDay = (todayDay % 7) + 1;
            int tomorrowWeek = (todayDay == 7) ? (currentWeek + 1) : currentWeek;

            // 3. 分时段判定与无课智能顺延
            String headerTag;
            String headerInfo = String.format(Locale.CHINA, "第%d周 · %s", currentWeek, getDayName(todayDay));
            String emptyTitle = "当前暂无课程";
            String emptySubtitle = "享受轻松时光 · 点击查看周课表";
            List<CourseEntry> displayList;

            if (hour >= 20 || hour < 7) {
                // 20:00 ~ 次日 07:00 -> 显示第二天的全部课程
                displayList = filterCourses(allCourses, tomorrowWeek, tomorrowDay, "all_day");
                headerTag = "🌙 明日全部课程";
                headerInfo = String.format(Locale.CHINA, "第%d周 · 明日%s", tomorrowWeek, getDayName(tomorrowDay));
                if (displayList.isEmpty()) {
                    emptyTitle = "明日无课程安排";
                    emptySubtitle = "好好休息，享受轻松夜晚 ☕";
                }
            } else if (hour >= 7 && hour < 12) {
                // 07:00 ~ 12:00 -> 优先显示上午课
                displayList = filterCourses(allCourses, currentWeek, todayDay, "morning");
                headerTag = "☀️ 今日上午课程";
                if (displayList.isEmpty()) {
                    // 顺延1：今天下午
                    displayList = filterCourses(allCourses, currentWeek, todayDay, "afternoon");
                    if (!displayList.isEmpty()) {
                        headerTag = "🌤️ 上午无课 · 今日下午预告";
                    } else {
                        // 顺延2：今天晚上
                        displayList = filterCourses(allCourses, currentWeek, todayDay, "evening");
                        if (!displayList.isEmpty()) {
                            headerTag = "🌤️ 下午无课 · 今晚课程预告";
                        } else {
                            // 顺延3：明天全天
                            displayList = filterCourses(allCourses, tomorrowWeek, tomorrowDay, "all_day");
                            if (!displayList.isEmpty()) {
                                headerTag = "🎉 今日无课 · 明日预告";
                                headerInfo = String.format(Locale.CHINA, "第%d周 · 明日%s", tomorrowWeek, getDayName(tomorrowDay));
                            } else {
                                emptyTitle = "近期暂无课程安排";
                                emptySubtitle = "今天无课，放松一下吧 ☕";
                            }
                        }
                    }
                }
            } else if (hour >= 12 && hour < 17) {
                // 12:00 ~ 17:00 -> 优先显示下午课
                displayList = filterCourses(allCourses, currentWeek, todayDay, "afternoon");
                headerTag = "⛅ 今日下午课程";
                if (displayList.isEmpty()) {
                    // 顺延1：今天晚上
                    displayList = filterCourses(allCourses, currentWeek, todayDay, "evening");
                    if (!displayList.isEmpty()) {
                        headerTag = "⛅ 下午无课 · 今晚预告";
                    } else {
                        // 顺延2：明天全天
                        displayList = filterCourses(allCourses, tomorrowWeek, tomorrowDay, "all_day");
                        if (!displayList.isEmpty()) {
                            headerTag = "🎉 今日已无课 · 明日预告";
                            headerInfo = String.format(Locale.CHINA, "第%d周 · 明日%s", tomorrowWeek, getDayName(tomorrowDay));
                        } else {
                            emptyTitle = "近期暂无课程安排";
                            emptySubtitle = "今天课程已结束 ☕";
                        }
                    }
                }
            } else {
                // 17:00 ~ 20:00 -> 优先显示晚上课
                displayList = filterCourses(allCourses, currentWeek, todayDay, "evening");
                headerTag = "🌙 今晚课程";
                if (displayList.isEmpty()) {
                    // 顺延：明天全天
                    displayList = filterCourses(allCourses, tomorrowWeek, tomorrowDay, "all_day");
                    if (!displayList.isEmpty()) {
                        headerTag = "🌙 今晚无课 · 明日预告";
                        headerInfo = String.format(Locale.CHINA, "第%d周 · 明日%s", tomorrowWeek, getDayName(tomorrowDay));
                    } else {
                        emptyTitle = "近期暂无课程安排";
                        emptySubtitle = "今晚无课，好好休息 ☕";
                    }
                }
            }

            // 4. 绑定界面渲染
            views.setTextViewText(R.id.widget_header_tag, headerTag);
            views.setTextViewText(R.id.widget_header_info, headerInfo);

            if (displayList.isEmpty()) {
                views.setViewVisibility(R.id.widget_courses_container, View.GONE);
                views.setViewVisibility(R.id.widget_empty_view, View.VISIBLE);
                views.setTextViewText(R.id.widget_empty_title, emptyTitle);
                views.setTextViewText(R.id.widget_empty_subtitle, emptySubtitle);
                views.setViewVisibility(R.id.widget_extra_count, View.GONE);
            } else {
                views.setViewVisibility(R.id.widget_empty_view, View.GONE);
                views.setViewVisibility(R.id.widget_courses_container, View.VISIBLE);

                // 条目 1
                CourseEntry c1 = displayList.get(0);
                views.setViewVisibility(R.id.widget_item_1, View.VISIBLE);
                views.setTextViewText(R.id.widget_item_name_1, c1.name);
                views.setTextViewText(R.id.widget_item_time_1, c1.startTime + "-" + c1.endTime);
                views.setTextViewText(R.id.widget_item_section_1, "第" + c1.startSection + "-" + c1.endSection + "节");
                views.setTextViewText(R.id.widget_item_room_1, c1.location); // 严格100%全称
                views.setTextViewText(R.id.widget_item_teacher_1, c1.teacher);

                // 条目 2
                if (displayList.size() >= 2) {
                    CourseEntry c2 = displayList.get(1);
                    views.setViewVisibility(R.id.widget_item_2, View.VISIBLE);
                    views.setTextViewText(R.id.widget_item_name_2, c2.name);
                    views.setTextViewText(R.id.widget_item_time_2, c2.startTime + "-" + c2.endTime);
                    views.setTextViewText(R.id.widget_item_section_2, "第" + c2.startSection + "-" + c2.endSection + "节");
                    views.setTextViewText(R.id.widget_item_room_2, c2.location);
                    views.setTextViewText(R.id.widget_item_teacher_2, c2.teacher);
                } else {
                    views.setViewVisibility(R.id.widget_item_2, View.GONE);
                }

                // 条目 3
                if (displayList.size() >= 3) {
                    CourseEntry c3 = displayList.get(2);
                    views.setViewVisibility(R.id.widget_item_3, View.VISIBLE);
                    views.setTextViewText(R.id.widget_item_name_3, c3.name);
                    views.setTextViewText(R.id.widget_item_time_3, c3.startTime + "-" + c3.endTime);
                    views.setTextViewText(R.id.widget_item_section_3, "第" + c3.startSection + "-" + c3.endSection + "节");
                    views.setTextViewText(R.id.widget_item_room_3, c3.location);
                    views.setTextViewText(R.id.widget_item_teacher_3, c3.teacher);
                } else {
                    views.setViewVisibility(R.id.widget_item_3, View.GONE);
                }

                if (displayList.size() > 3) {
                    views.setViewVisibility(R.id.widget_extra_count, View.VISIBLE);
                    views.setTextViewText(R.id.widget_extra_count, "+" + (displayList.size() - 3) + "门");
                } else {
                    views.setViewVisibility(R.id.widget_extra_count, View.GONE);
                }
            }

            // 5. 点击整个小组件跳转至主 App
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

            // 6. 提交更新
            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Throwable t) {
            t.printStackTrace();
            try {
                // 安全降级：显示空状态基础视图，防止系统报“载入窗口小部件时出现问题”
                RemoteViews fallback = new RemoteViews(context.getPackageName(), R.layout.widget_course_4x2);
                fallback.setViewVisibility(R.id.widget_courses_container, View.GONE);
                fallback.setViewVisibility(R.id.widget_empty_view, View.VISIBLE);
                fallback.setTextViewText(R.id.widget_header_tag, "☀️ 课程表");
                fallback.setTextViewText(R.id.widget_header_info, "点击打开应用");
                fallback.setTextViewText(R.id.widget_empty_title, "课程表已就绪");
                fallback.setTextViewText(R.id.widget_empty_subtitle, "点击进入应用查看完整课表");
                Intent intent = new Intent(context, MainActivity.class);
                PendingIntent pendingIntent = PendingIntent.getActivity(
                        context, 0, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                fallback.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
                appWidgetManager.updateAppWidget(appWidgetId, fallback);
            } catch (Throwable ignored) {}
        }
    }

    private static List<CourseEntry> filterCourses(List<CourseEntry> all, int week, int dayOfWeek, String bucket) {
        List<CourseEntry> result = new ArrayList<>();
        for (CourseEntry c : all) {
            if (c.isCancelled) continue;
            if (c.dayOfWeek != dayOfWeek) continue;
            if (!c.isHappeningInWeek(week)) continue;

            if ("morning".equals(bucket)) {
                if (c.startSection <= 4 || (!c.startTime.isEmpty() && c.startTime.compareTo("12:00") < 0)) {
                    result.add(c);
                }
            } else if ("afternoon".equals(bucket)) {
                boolean isAfternoon = (c.startSection >= 5 && c.startSection <= 8)
                        || (!c.startTime.isEmpty() && c.startTime.compareTo("12:00") >= 0 && c.startTime.compareTo("17:00") < 0);
                if (isAfternoon) {
                    result.add(c);
                }
            } else if ("evening".equals(bucket)) {
                boolean isEvening = (c.startSection >= 9)
                        || (!c.startTime.isEmpty() && c.startTime.compareTo("17:00") >= 0);
                if (isEvening) {
                    result.add(c);
                }
            } else {
                result.add(c);
            }
        }

        Collections.sort(result, new Comparator<CourseEntry>() {
            @Override
            public int compare(CourseEntry o1, CourseEntry o2) {
                return Integer.compare(o1.startSection, o2.startSection);
            }
        });
        return result;
    }

    private static int calculateCurrentWeek(String semesterStartDateStr, Date nowDate) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
            Date startDate = sdf.parse(semesterStartDateStr);
            if (startDate != null) {
                long diffMs = nowDate.getTime() - startDate.getTime();
                long diffDays = diffMs / (1000L * 60 * 60 * 24);
                int week = (int) (diffDays / 7) + 1;
                return Math.max(1, Math.min(week, 25));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return 2; // 默认第2周
    }

    private static String getDayName(int day) {
        switch (day) {
            case 1: return "周一";
            case 2: return "周二";
            case 3: return "周三";
            case 4: return "周四";
            case 5: return "周五";
            case 6: return "周六";
            case 7: return "周日";
            default: return "";
        }
    }

    private static List<CourseEntry> parseCourses(String json) {
        List<CourseEntry> list = new ArrayList<>();
        if (json == null || json.trim().isEmpty()) {
            return getFallbackCourses();
        }
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                String name = obj.optString("name", "未命名课程");
                boolean isObjCancelled = "cancelled".equalsIgnoreCase(obj.optString("status", ""))
                        || "cancelled".equalsIgnoreCase(obj.optString("actionType", obj.optString("action_type", "")))
                        || obj.optBoolean("isReduced", false)
                        || obj.optBoolean("isCancelled", false);

                JSONArray schedules = obj.optJSONArray("schedules");
                if (schedules != null && schedules.length() > 0) {
                    for (int s = 0; s < schedules.length(); s++) {
                        JSONObject sc = schedules.getJSONObject(s);
                        CourseEntry entry = new CourseEntry();
                        entry.name = name;
                        entry.teacher = sc.optString("teacher", obj.optString("teacher", ""));
                        entry.location = sc.optString("location", obj.optString("location", sc.optString("classroom", "")));
                        entry.dayOfWeek = sc.optInt("dayOfWeek", obj.optInt("dayOfWeek", 1));
                        entry.startSection = sc.optInt("startPeriod", sc.optInt("startSection", obj.optInt("startPeriod", obj.optInt("startSection", 1))));
                        entry.endSection = sc.optInt("endPeriod", sc.optInt("endSection", obj.optInt("endPeriod", obj.optInt("endSection", 1))));
                        entry.startTime = sc.optString("startTime", obj.optString("startTime", "08:00"));
                        entry.endTime = sc.optString("endTime", obj.optString("endTime", "09:50"));
                        entry.startWeek = sc.optInt("startWeek", obj.optInt("startWeek", 1));
                        entry.endWeek = sc.optInt("endWeek", obj.optInt("endWeek", 20));
                        entry.weekType = sc.optString("weekType", obj.optString("weekType", "all"));
                        entry.isCancelled = isObjCancelled || "cancelled".equalsIgnoreCase(sc.optString("status", ""))
                                || sc.optBoolean("isCancelled", false) || sc.optBoolean("isReduced", false);

                        JSONArray weeksArr = sc.optJSONArray("weeks");
                        if (weeksArr != null) {
                            for (int w = 0; w < weeksArr.length(); w++) {
                                entry.weeks.add(weeksArr.getInt(w));
                            }
                        }
                        list.add(entry);
                    }
                } else {
                    CourseEntry entry = new CourseEntry();
                    entry.name = name;
                    entry.teacher = obj.optString("teacher", "");
                    entry.location = obj.optString("location", obj.optString("classroom", ""));
                    entry.dayOfWeek = obj.optInt("dayOfWeek", 1);
                    entry.startSection = obj.optInt("startPeriod", obj.optInt("startSection", 1));
                    entry.endSection = obj.optInt("endPeriod", obj.optInt("endSection", 1));
                    entry.startTime = obj.optString("startTime", "08:00");
                    entry.endTime = obj.optString("endTime", "09:50");
                    entry.startWeek = obj.optInt("startWeek", 1);
                    entry.endWeek = obj.optInt("endWeek", 20);
                    entry.weekType = obj.optString("weekType", "all");
                    entry.isCancelled = isObjCancelled;

                    JSONArray weeksArr = obj.optJSONArray("weeks");
                    if (weeksArr != null) {
                        for (int w = 0; w < weeksArr.length(); w++) {
                            entry.weeks.add(weeksArr.getInt(w));
                        }
                    }
                    list.add(entry);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
            return getFallbackCourses();
        }
        return list;
    }

    private static List<CourseEntry> getFallbackCourses() {
        // 内置默认 13 门课示例
        List<CourseEntry> list = new ArrayList<>();
        CourseEntry c1 = new CourseEntry();
        c1.name = "马克思主义基本原理";
        c1.location = "行知组团-E楼302";
        c1.teacher = "夏金华";
        c1.dayOfWeek = 1;
        c1.startSection = 1;
        c1.endSection = 2;
        c1.startTime = "08:00";
        c1.endTime = "09:50";
        c1.startWeek = 2;
        c1.endWeek = 13;
        list.add(c1);

        CourseEntry c2 = new CourseEntry();
        c2.name = "日语入门";
        c2.location = "行知组团-D楼112";
        c2.teacher = "汪天梅";
        c2.dayOfWeek = 1;
        c2.startSection = 3;
        c2.endSection = 4;
        c2.startTime = "10:10";
        c2.endTime = "12:00";
        c2.startWeek = 2;
        c2.endWeek = 17;
        list.add(c2);

        CourseEntry c3 = new CourseEntry();
        c3.name = "毛泽东思想概论";
        c3.location = "行知组团-E楼204";
        c3.teacher = "杨昆";
        c3.dayOfWeek = 1;
        c3.startSection = 5;
        c3.endSection = 6;
        c3.startTime = "13:30";
        c3.endTime = "15:20";
        c3.startWeek = 2;
        c3.endWeek = 13;
        list.add(c3);

        CourseEntry c4 = new CourseEntry();
        c4.name = "Web前端实训";
        c4.location = "工科楼南309-1";
        c4.teacher = "武扬";
        c4.dayOfWeek = 1;
        c4.startSection = 7;
        c4.endSection = 10;
        c4.startTime = "15:40";
        c4.endTime = "20:20";
        c4.startWeek = 2;
        c4.endWeek = 13;
        list.add(c4);

        return list;
    }
}